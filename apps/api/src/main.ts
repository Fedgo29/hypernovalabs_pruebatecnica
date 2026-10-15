import "reflect-metadata";
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { DbModule } from "./db";
import { AuthModule } from "./auth";
import { CommerceModule } from "./commerce";
import { EventsModule } from "./events";
import { AdminModule } from "./admin";
import { AccessModule } from "./access/access.module";
import { initializeDatabase } from "./bootstrap";
import { OperationsModule } from "./operations";

@Module({
  imports: [
    DbModule,
    AuthModule,
    EventsModule,
    CommerceModule,
    AdminModule,
    AccessModule,
    OperationsModule,
  ],
})
class AppModule {}

@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const databaseCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    let status =
      error instanceof HttpException
        ? error.getStatus()
        : ["23505", "23514", "23503"].includes(databaseCode)
          ? 409
          : databaseCode === "22P02"
            ? 400
            : 500;
    const payload =
      error instanceof HttpException
        ? error.getResponse()
        : {
            code:
              status === 409
                ? "CONSTRAINT_CONFLICT"
                : status === 400
                  ? "INVALID_INPUT"
                  : "INTERNAL_ERROR",
            message:
              status === 409
                ? "This operation conflicts with existing data"
                : status === 400
                  ? "Invalid input format"
                  : "An unexpected server error occurred",
          };
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          correlationId: response.getHeader("x-correlation-id"),
          path: request.path,
          message: error instanceof Error ? error.message : "Unknown error",
          code: databaseCode,
        }),
      );
    response.status(status).json({
      error:
        typeof payload === "string"
          ? { code: "HTTP_ERROR", message: payload }
          : payload,
      correlationId: response.getHeader("x-correlation-id"),
    });
  }
}
async function main(): Promise<void> {
  if (process.env.INITIALIZE_DATABASE !== "0") await initializeDatabase();
  delete process.env.DATABASE_ADMIN_URL;
  delete process.env.DB_APP_PASSWORD;
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ErrorFilter());
  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",")
      : true,
    credentials: false,
    exposedHeaders: ["x-correlation-id"],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const supplied = request.header("x-correlation-id");
    const correlationId =
      supplied && /^[a-zA-Z0-9_-]{1,80}$/.test(supplied)
        ? supplied
        : randomUUID();
    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("x-content-type-options", "nosniff");
    const started = process.hrtime.bigint();
    response.on("finish", () =>
      console.log(
        JSON.stringify({
          level: "info",
          correlationId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        }),
      ),
    );
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      ["POST", "PATCH", "PUT"].includes(request.method) &&
      request.body !== undefined &&
      (request.body === null ||
        typeof request.body !== "object" ||
        Array.isArray(request.body))
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "Request body must be a JSON object",
        },
        correlationId: response.getHeader("x-correlation-id"),
      });
      return;
    }
    if (
      ["POST", "PATCH", "PUT"].includes(request.method) &&
      request.body === undefined
    )
      request.body = {};
    next();
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(JSON.stringify({ level: "info", message: "api_ready", port }));
}
void main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: error instanceof Error ? error.message : "Startup failed",
    }),
  );
  process.exit(1);
});
