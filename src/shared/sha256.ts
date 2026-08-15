const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_LENGTH_MASK = (1n << 64n) - 1n;

/**
 * Runtime-neutral incremental SHA-256. It accepts byte chunks so Report code
 * can hash unbounded JavaScript strings without constructing one full preimage.
 */
export class Sha256 {
  readonly #state = new Uint32Array(SHA256_INITIAL);
  readonly #buffer = new Uint8Array(64);
  #bufferLength = 0;
  #byteLength = 0n;
  #finalDigest: Uint8Array | undefined;

  update(input: Uint8Array): this {
    if (this.#finalDigest !== undefined) {
      throw new TypeError("SHA-256 cannot accept input after digest()");
    }
    if (!(input instanceof Uint8Array)) {
      throw new TypeError("SHA-256 input must be a Uint8Array");
    }

    this.#byteLength += BigInt(input.byteLength);
    let offset = 0;

    if (this.#bufferLength > 0) {
      const copied = Math.min(64 - this.#bufferLength, input.byteLength);
      this.#buffer.set(input.subarray(0, copied), this.#bufferLength);
      this.#bufferLength += copied;
      offset = copied;
      if (this.#bufferLength === 64) {
        compress(this.#state, this.#buffer, 0);
        this.#bufferLength = 0;
      }
    }

    while (offset + 64 <= input.byteLength) {
      compress(this.#state, input, offset);
      offset += 64;
    }

    if (offset < input.byteLength) {
      const remainder = input.subarray(offset);
      this.#buffer.set(remainder, 0);
      this.#bufferLength = remainder.byteLength;
    }

    return this;
  }

  /** Finalizes this hash. Repeated calls return independent copies of one digest. */
  digest(): Uint8Array {
    if (this.#finalDigest !== undefined) {
      return new Uint8Array(this.#finalDigest);
    }
    const state = new Uint32Array(this.#state);
    const tail = new Uint8Array(this.#bufferLength < 56 ? 64 : 128);
    tail.set(this.#buffer.subarray(0, this.#bufferLength));
    tail[this.#bufferLength] = 0x80;
    writeU64BE(tail, tail.byteLength - 8, (this.#byteLength * 8n) & SHA256_LENGTH_MASK);
    compress(state, tail, 0);
    if (tail.byteLength === 128) {
      compress(state, tail, 64);
    }

    const digest = new Uint8Array(32);
    for (let index = 0; index < state.length; index += 1) {
      const word = state[index]!;
      const offset = index * 4;
      digest[offset] = word >>> 24;
      digest[offset + 1] = word >>> 16;
      digest[offset + 2] = word >>> 8;
      digest[offset + 3] = word;
    }
    this.#finalDigest = digest;
    return new Uint8Array(digest);
  }
}

/** One-shot convenience for bounded byte values. */
export function sha256(input: Uint8Array): Uint8Array {
  return new Sha256().update(input).digest();
}

function compress(state: Uint32Array, block: Uint8Array, offset: number): void {
  const words = new Uint32Array(64);
  for (let index = 0; index < 16; index += 1) {
    const wordOffset = offset + index * 4;
    words[index] = (
      (block[wordOffset]! << 24)
      | (block[wordOffset + 1]! << 16)
      | (block[wordOffset + 2]! << 8)
      | block[wordOffset + 3]!
    ) >>> 0;
  }
  for (let index = 16; index < 64; index += 1) {
    const prior15 = words[index - 15]!;
    const prior2 = words[index - 2]!;
    const sigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
    const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
    words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
  }

  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;
  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choose = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choose + SHA256_ROUND[index]! + words[index]!) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }
  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
  state[5] = (state[5]! + f) >>> 0;
  state[6] = (state[6]! + g) >>> 0;
  state[7] = (state[7]! + h) >>> 0;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function writeU64BE(target: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    target[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}
