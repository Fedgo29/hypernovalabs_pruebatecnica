import "reflect-metadata";
import { initializeDatabase } from "./bootstrap";

void initializeDatabase()
  .then(() => {
    console.log(
      JSON.stringify({ level: "info", message: "database_initialized" }),
    );
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Database initialization failed",
      }),
    );
    process.exitCode = 1;
  });
