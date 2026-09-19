import { startLocalServer } from "./server.js";

if (process.env.NODE_ENV !== "test") {
  startLocalServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { startLocalServer };
