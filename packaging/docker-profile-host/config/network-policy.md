# Managed-rootless network policy

The profile descriptor pins public DNS resolvers, blocked destination CIDRs,
IPv6 disabled, RootlessKit host-loopback/port settings, daemon `bridge=none`,
and exclusive Attempt networks with ICC disabled.  All fields contribute to the
semantic policy revision.

The hard egress rules live in the RootlessKit child network namespace that
contains dockerd, the Docker bridges, and `tap0`.  Outer container traffic hits
`FORWARD`; daemon and BuildKit traffic hits `OUTPUT`.  The chain:

1. permits established traffic;
2. permits UDP/TCP 53 only to descriptor-pinned resolvers;
3. rejects all other UDP/TCP 53;
4. rejects synthetic, host, LAN, and special-purpose destination CIDRs;
5. permits new HTTPS and rejects every other new outbound flow.

This placement cannot be changed by a privileged outer workload: the workload
has capabilities only in its child user/network namespace and receives neither
the outer Docker socket nor the control socket.  Editing `/etc/resolv.conf`,
querying another resolver, or connecting to a literal fake/private IP still
crosses the child-netns egress chain.

`port-driver=none` prevents published ports; it is not the outbound boundary.
`enable_icc=false` remains required on each exclusive Attempt bridge.  IPv6 is
disabled in v1 so the IPv4 policy has no unguarded IPv6 counterpart.

Live acceptance must prove rule counters increase on both `FORWARD` and
`OUTPUT`, then cover resolver rewrite, `10.0.2.3`, arbitrary port 53, literal
198.18/15, sibling private IP, host/LAN destinations, public DNS/HTTPS, outer
pull/build, inner pull, and Compose DNS.  Admission stays closed after daemon or
watchdog restart until these facts and the ruleset digest attest again.
