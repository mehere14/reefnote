process.env.HOST ||= '127.0.0.1';
process.env.PORT ||= '4317';
process.env.BODY_SIZE_LIMIT ||= '20M';
if (!process.env.ORIGIN && ['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST)) {
  const host = process.env.HOST === '::1' ? '[::1]' : process.env.HOST;
  process.env.ORIGIN = `http://${host}:${process.env.PORT}`;
}
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST) && !process.env.NOVEL_STUDIO_PASSWORD) {
  console.error('Set NOVEL_STUDIO_PASSWORD before exposing Novel Studio on a public interface.');
  process.exit(1);
}
await import('../build/index.js');
