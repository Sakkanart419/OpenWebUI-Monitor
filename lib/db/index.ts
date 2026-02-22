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
    console.log('[STARTUP] Ensuring system_stats table exists...')
    const startTime = Date.now()

    await query(`
        CREATE TABLE IF NOT EXISTS system_stats (
            key TEXT PRIMARY KEY,
            value_decimal DECIMAL(16, 4) DEFAULT 0.0000,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `)

    // Ensure value_text column exists
    console.log('[STARTUP] Adding value_text column to system_stats...')
    await query(`
        DO $$
        BEGIN
            BEGIN
                ALTER TABLE system_stats ADD COLUMN value_text TEXT;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
            END;
        END $$;
    `)

    // Initialize global config records if they don't exist
    console.log('[STARTUP] Initializing global config records...')
    const keys = ['global_usage_total', 'global_limit_enable', 'global_limit_quota', 'global_limit_start_date', 'global_limit_expire_date']
    for (const key of keys) {
        const result = await query("SELECT key, value_decimal, value_text FROM system_stats WHERE key = $1", [key])
        
        let value_decimal = null
        let value_text = null
        let shouldUpdate = false

        if (key === 'global_usage_total') {
            if (result.rows.length === 0) {
                console.log('[STARTUP] Calculating initial global usage total...')
                const usageResult = await query('SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records')
                value_decimal = usageResult.rows[0].total
                console.log(`[STARTUP] Initial global usage total: ${value_decimal}`)
                shouldUpdate = true
            }
        } else if (key === 'global_limit_enable') {
            value_text = (process.env.GLOBAL_LIMIT_ENABLE === 'true').toString()
            if (result.rows.length === 0 || result.rows[0].value_text !== value_text) {
                shouldUpdate = true
            }
        } else if (key === 'global_limit_quota') {
            value_decimal = parseFloat(process.env.GLOBAL_LIMIT_QUOTA || '0')
            if (result.rows.length === 0 || parseFloat(result.rows[0].value_decimal || '0') !== value_decimal) {
                shouldUpdate = true
            }
        } else if (key === 'global_limit_start_date') {
            value_text = process.env.GLOBAL_LIMIT_START_DATE || null
            if (result.rows.length === 0 || result.rows[0].value_text !== value_text) {
                shouldUpdate = true
            }
        } else if (key === 'global_limit_expire_date') {
            value_text = process.env.GLOBAL_LIMIT_EXPIRE_DATE || null
            if (result.rows.length === 0 || result.rows[0].value_text !== value_text) {
                shouldUpdate = true
            }
        }

        if (shouldUpdate) {
            if (result.rows.length === 0) {
                await query(
                    "INSERT INTO system_stats (key, value_decimal, value_text) VALUES ($1, $2, $3)",
                    [key, value_decimal, value_text]
                )
            } else {
                await query(
                    "UPDATE system_stats SET value_decimal = $2, value_text = $3, updated_at = CURRENT_TIMESTAMP WHERE key = $1",
                    [key, value_decimal, value_text]
                )
            }

            // If any limit config changed, re-sync usage total for the period
            if (key.startsWith('global_limit_')) {
                const currentConfig = await getGlobalConfig()
                await syncGlobalUsageInPeriod(currentConfig.startDate, currentConfig.expireDate)
            }
        }
    }

    const duration = Date.now() - startTime
    console.log(`[STARTUP] system_stats table setup completed in ${duration}ms`)
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

export async function syncGlobalUsageInPeriod(startDate?: string, endDate?: string) {
    let queryText = 'SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records WHERE 1=1'
    const params: any[] = []

    if (startDate && startDate !== 'null') {
        params.push(startDate + ' 00:00:00')
        queryText += ` AND use_time >= $${params.length}`
    }
    if (endDate && endDate !== 'null') {
        params.push(endDate + ' 23:59:59')
        queryText += ` AND use_time <= $${params.length}`
    }

    const usageResult = await query(queryText, params)
    const total = usageResult.rows[0].total

    await query(
        "UPDATE system_stats SET value_decimal = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_usage_total'",
        [total]
    )
    return total
}

export async function updateGlobalConfig(config: { enable?: boolean, quota?: number, startDate?: string, expireDate?: string }) {
    if (config.enable !== undefined) {
        await query(
            "UPDATE system_stats SET value_text = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_limit_enable'",
            [config.enable.toString()]
        )
    }
    if (config.quota !== undefined) {
        await query(
            "UPDATE system_stats SET value_decimal = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_limit_quota'",
            [config.quota]
        )
    }
    if (config.startDate !== undefined) {
        await query(
            "UPDATE system_stats SET value_text = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_limit_start_date'",
            [config.startDate]
        )
    }
    if (config.expireDate !== undefined) {
        await query(
            "UPDATE system_stats SET value_text = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_limit_expire_date'",
            [config.expireDate]
        )
    }

    // Auto-sync usage when config changes
    const currentConfig = await getGlobalConfig()
    const startDate = config.startDate || currentConfig.startDate
    const endDate = config.expireDate || currentConfig.expireDate
    await syncGlobalUsageInPeriod(startDate, endDate)
}

export async function getGlobalConfig() {
    const results = await query(
        "SELECT key, value_decimal, value_text FROM system_stats WHERE key IN ('global_limit_enable', 'global_limit_quota', 'global_limit_start_date', 'global_limit_expire_date', 'global_usage_total')"
    )

    const config: any = {}
    results.rows.forEach(row => {
        if (row.key === 'global_limit_enable') {
            config.enable = row.value_text === 'true'
        } else if (row.key === 'global_limit_quota') {
            config.quota = parseFloat(row.value_decimal || '0')
        } else if (row.key === 'global_limit_start_date') {
            config.startDate = row.value_text
        } else if (row.key === 'global_limit_expire_date') {
            config.expireDate = row.value_text
        } else if (row.key === 'global_usage_total') {
            config.usage = parseFloat(row.value_decimal || '0')
        }
    })

    return config
}

export async function ensureTablesExist() {
    console.log('[STARTUP] Starting database table initialization...')

    const startTime = Date.now()
    await ensureModelPricesTableExists()
    const afterModels = Date.now()
    console.log(`[STARTUP] Model prices table: ${afterModels - startTime}ms`)

    await ensureUserTableExists()
    const afterUsers = Date.now()
    console.log(`[STARTUP] Users table: ${afterUsers - afterModels}ms`)

    await ensureGroupsTableExists()
    const afterGroups = Date.now()
    console.log(`[STARTUP] Groups table: ${afterGroups - afterUsers}ms`)

    await ensureUsageRecordsTableExists()
    const afterUsage = Date.now()
    console.log(`[STARTUP] Usage records table: ${afterUsage - afterGroups}ms`)

    await ensureTransactionsTableExists()
    const afterTransactions = Date.now()
    console.log(`[STARTUP] Transactions table: ${afterTransactions - afterUsage}ms`)

    await ensureSystemStatsTableExists()
    const afterSystemStats = Date.now()
    console.log(`[STARTUP] System stats table: ${afterSystemStats - afterTransactions}ms`)

    const totalDuration = Date.now() - startTime
    console.log(`[STARTUP] All database tables initialized successfully in ${totalDuration}ms`)
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
