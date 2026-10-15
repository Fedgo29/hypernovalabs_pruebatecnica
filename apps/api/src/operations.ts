import {
  Inject,
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Db } from "./db";
@Controller()
class OperationsController {
  constructor(@Inject(Db) private readonly db: Db) {}
  @Get(["health", "v1/health"]) health(): unknown {
    return { status: "ok" };
  }
  @Get(["readiness", "v1/readiness"]) async readiness(): Promise<unknown> {
    try {
      await this.db.query("SELECT 1");
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Database is not available",
      });
    }
  }
}
@Module({ controllers: [OperationsController] })
export class OperationsModule {}
