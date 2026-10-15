import { Global, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE ?? 25),
    connectionTimeoutMillis: 10000,
  });
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    args?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, args);
  }
  async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : "";
        if (!["40P01", "40001"].includes(String(code)) || attempt >= 2)
          throw error;
      } finally {
        client.release();
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 10 + Math.random() * 30),
      );
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
