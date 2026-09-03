// Preloaded with `node -r` by the CLI tests so `routerplate init` takes
// its interactive path while stdin/stdout are pipes. The tests also set
// TERM=dumb, which keeps readline from writing cursor escape codes.
process.stdin.isTTY = true;
process.stdout.isTTY = true;
