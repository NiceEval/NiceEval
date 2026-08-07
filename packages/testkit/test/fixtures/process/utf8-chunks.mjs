const target =
  "你好，世界！Hello, 世界。🎉🎊 Mixed 中英文 and some 中文末尾。";
const bytes = Buffer.from(target, "utf8");

function writeChunk(start, end) {
  return new Promise((resolve) => {
    process.stdout.write(bytes.subarray(start, end), resolve);
  });
}

// 在每个多字节字符中间切一刀，强制 split multibyte chunk；
// 同时多写几次不完整的 chunk，确保解码端必须拼回完整字节流。
await writeChunk(0, 2); // 切在“你”中间
await writeChunk(2, 7);
await writeChunk(7, 8); // 切在“！”后面一个字节处（“，世界”第一个字符中间）
await writeChunk(8, 16);
await writeChunk(16, 20); // 切在 emoji 🎉 中间
await writeChunk(20, 24);
await writeChunk(24, bytes.length);

process.stdout.write(`\nEND:${target.length}\n`, () => process.exit(0));
