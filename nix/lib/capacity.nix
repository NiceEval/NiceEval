# Capacity arithmetic for docker-profile host deployment.
# capacity = allocatable (after headroom already deducted by the admin declaration)
# aggregate = systemd cgroup hard limits (must cover allocatable + remaining headroom)
{ lib }:
let
  inherit (lib)
    isInt
    isString
    toInt
    toLower
    hasSuffix
    removeSuffix
    throwIf
    ;

  # Parse "28G", "28GiB", "512M", "8192" into integer bytes (binary units for K/M/G/T).
  parseBytes =
    value:
    if isInt value then
      value
    else if !isString value then
      throw "capacity size must be int or string, got ${builtins.typeOf value}"
    else
      let
        s = toLower value;
        stripB = if hasSuffix "b" s then removeSuffix "b" s else s;
        unit =
          if hasSuffix "ki" stripB then "ki"
          else if hasSuffix "mi" stripB then "mi"
          else if hasSuffix "gi" stripB then "gi"
          else if hasSuffix "ti" stripB then "ti"
          else if hasSuffix "k" stripB then "k"
          else if hasSuffix "m" stripB then "m"
          else if hasSuffix "g" stripB then "g"
          else if hasSuffix "t" stripB then "t"
          else "";
        numStr =
          if unit == "" then stripB
          else removeSuffix unit stripB;
        num = toInt numStr;
        mult =
          {
            "" = 1;
            k = 1024;
            ki = 1024;
            m = 1024 * 1024;
            mi = 1024 * 1024;
            g = 1024 * 1024 * 1024;
            gi = 1024 * 1024 * 1024;
            t = 1024 * 1024 * 1024 * 1024;
            ti = 1024 * 1024 * 1024 * 1024;
          }
          .${unit};
      in
      num * mult;

  # Parse CPU count: int or decimal string like "16" / "16.0".
  parseCpus =
    value:
    if isInt value then
      value
    else if isString value then
      toInt value
    else
      throw "cpus must be int or numeric string, got ${builtins.typeOf value}";

  # systemd CPUQuota percentage for N full CPUs.
  cpusToQuotaPercent = cpus: cpus * 100;

  validateCapacityVsAggregate =
    {
      capacity,
      aggregate,
      profileName ? "<profile>",
    }:
    let
      capCpus = parseCpus capacity.cpus;
      aggCpus = parseCpus aggregate.cpus;
      capMem = parseBytes capacity.memory;
      aggMem = parseBytes aggregate.memory;
      capPids = capacity.pids;
      aggPids = aggregate.pids;
      errors =
        (lib.optional (aggCpus < capCpus)
          "${profileName}: aggregate.cpus (${toString aggCpus}) < capacity.cpus/allocatable (${toString capCpus})"
        )
        ++ (lib.optional (aggMem < capMem)
          "${profileName}: aggregate.memory (${toString aggMem}) < capacity.memory/allocatable (${toString capMem})"
        )
        ++ (lib.optional (aggPids < capPids)
          "${profileName}: aggregate.pids (${toString aggPids}) < capacity.pids/allocatable (${toString capPids})"
        )
        ++ (lib.optional (capacity.memorySwapBytes or 0 != 0)
          "${profileName}: capacity.memorySwapBytes must be 0 (managed policy forbids swap)"
        )
        ++ (lib.optional (aggregate.memorySwapBytes or 0 != 0)
          "${profileName}: aggregate.memorySwapBytes must be 0"
        )
        ++ (lib.optional (capacity.maxContainers < 1)
          "${profileName}: capacity.maxContainers must be >= 1"
        )
        ++ (lib.optional (capacity.maxBuilds < 1)
          "${profileName}: capacity.maxBuilds must be >= 1"
        );
    in
    if errors == [ ] then
      {
        capacity = {
          cpus = capCpus;
          memoryBytes = capMem;
          memorySwapBytes = 0;
          pids = capPids;
          maxContainers = capacity.maxContainers;
          maxBuilds = capacity.maxBuilds;
        };
        aggregate = {
          cpus = aggCpus;
          memoryBytes = aggMem;
          memorySwapBytes = 0;
          pids = aggPids;
          cpuQuotaPercent = cpusToQuotaPercent aggCpus;
        };
        headroom = {
          cpus = aggCpus - capCpus;
          memoryBytes = aggMem - capMem;
          pids = aggPids - capPids;
        };
      }
    else
      throw (lib.concatStringsSep "\n" errors);

in
{
  inherit parseBytes parseCpus cpusToQuotaPercent validateCapacityVsAggregate;
}
