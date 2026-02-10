import { query } from './client'
import { ensureUserTableExists } from './users'
import { ModelPrice, updateModelPrice } from './client'

async function ensureModelPricesTableExists() {
    const defaultInputPrice = parseFloat(
        process.env.DEFAULT_MODEL_INPUT_PRICE || '60'
    )
    const defaultOutputPrice = parseFloat(
        process.env.DEFAULT_MODEL_OUTPUT_PRICE || '60'
    )
    const defaultPerMsgPrice = parseFloat(
        process.env.DEFAULT_MODEL_PER_MSG_PRICE || '-1'
    )

    await query(
        `CREATE TABLE IF NOT EXISTS model_prices (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      input_price DECIMAL(10, 6) DEFAULT CAST($1 AS DECIMAL(10, 6)),
      output_price DECIMAL(10, 6) DEFAULT CAST($2 AS DECIMAL(10, 6)),
      per_msg_price DECIMAL(10, 6) DEFAULT CAST($3 AS DECIMAL(10, 6)),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`,
        [defaultInputPrice, defaultOutputPrice, defaultPerMsgPrice]
    )

    await query(
        `DO $$ 
    BEGIN 
      BEGIN
        ALTER TABLE model_prices ADD COLUMN per_msg_price DECIMAL(10, 6) DEFAULT CAST($1 AS DECIMAL(10, 6));
        ALTER TABLE model_prices ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      EXCEPTION 
        WHEN duplicate_column THEN NULL;
      END;
    END $$;`,
        [defaultPerMsgPrice]
    )
}

async function ensureGroupsTableExists() {
    await query(`
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            admin_email TEXT,
            balance DECIMAL(16, 4) DEFAULT 0.0000,
            alert_threshold DECIMAL(10, 2) DEFAULT 10.00,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `)

    await query(`
        CREATE TABLE IF NOT EXISTS user_group_mapping (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `)
}

async function ensureTransactionsTableExists() {
    await query(`
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
            type TEXT NOT NULL, -- 'USAGE', 'TOPUP', 'REFUND'
            source TEXT NOT NULL, -- 'PERSONAL', 'GROUP'
            amount DECIMAL(16, 4) NOT NULL,
            model_id TEXT,
            record_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `)

    await query(`
        DO $$ 
        BEGIN 
            BEGIN
                ALTER TABLE transactions ADD COLUMN record_id INTEGER;
            EXCEPTION 
                WHEN duplicate_column THEN NULL;
            END;
        END $$;
    `)
}

async function ensureUsageRecordsTableExists() {
    await query(`
        CREATE TABLE IF NOT EXISTS user_usage_records (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            nickname TEXT NOT NULL,
            use_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            model_name TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            cost DECIMAL(16, 4) NOT NULL,
            balance_after DECIMAL(16, 4) NOT NULL
        );
    `)
}

async function ensureSystemStatsTableExists() {
    await query(`
        CREATE TABLE IF NOT EXISTS system_stats (
            key TEXT PRIMARY KEY,
            value_decimal DECIMAL(16, 4) DEFAULT 0.0000,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `)

    // Initialize global_usage_total if it doesn't exist
    const result = await query(
        "SELECT key FROM system_stats WHERE key = 'global_usage_total'"
    )
    if (result.rows.length === 0) {
        // Calculate initial total from existing records
        const usageResult = await query(
            'SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records'
        )
        const total = usageResult.rows[0].total

        await query(
            "INSERT INTO system_stats (key, value_decimal) VALUES ('global_usage_total', $1)",
            [total]
        )
    }
}

export async function syncGlobalUsage() {
    const usageResult = await query(
        'SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records'
    )
    const total = usageResult.rows[0].total

    await query(
        "UPDATE system_stats SET value_decimal = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_usage_total'",
        [total]
    )
    return total
}

export async function ensureTablesExist() {
    await ensureModelPricesTableExists()
    await ensureUserTableExists()
    await ensureGroupsTableExists()
    await ensureUsageRecordsTableExists()
    await ensureTransactionsTableExists()
    await ensureSystemStatsTableExists()
}

export async function getOrCreateModelPrice(
    id: string,
    name: string
): Promise<ModelPrice> {
    try {
        const defaultPerMsgPrice = parseFloat(
            process.env.DEFAULT_MODEL_PER_MSG_PRICE || '-1'
        )

        const result = await query(
            `INSERT INTO model_prices (id, model_name, per_msg_price, updated_at)
       VALUES ($1, $2, CAST($3 AS DECIMAL(10, 6)), CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE 
       SET model_name = $2, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
            [id, name, defaultPerMsgPrice]
        )

        return {
            id: result.rows[0].id,
            name: result.rows[0].model_name,
            input_price: Number(result.rows[0].input_price),
            output_price: Number(result.rows[0].output_price),
            per_msg_price: Number(result.rows[0].per_msg_price),
            updated_at: result.rows[0].updated_at,
        }
    } catch (error: any) {
        console.error('Error in getOrCreateModelPrice:', error)
        if (error.message.includes('Connection terminated unexpectedly')) {
            console.log('Retrying database connection...')
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return getOrCreateModelPrice(id, name)
        }
        throw error
    }
}

export {
    getUsers,
    getOrCreateUser,
    updateUserBalance,
    deleteUser,
} from './users'
