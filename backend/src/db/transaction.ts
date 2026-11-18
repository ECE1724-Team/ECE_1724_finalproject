
import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
    pool: Pool,
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    let discard: true | undefined;

    try {
        await client.query("BEGIN");

        const result = await callback(client);

        await client.query("COMMIT");

        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            discard = true;
            console.error("Transaction rollback failed:", rollbackError);
        }

        throw error;
    } finally {
        client.release(discard);
    }
}
