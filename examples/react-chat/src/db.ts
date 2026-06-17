import { postgres, type PostgresQuery } from '@flue/postgres';
import sql from 'postgres';

// Persistence adapter. The runtime auto-discovers a default-exported adapter
// from `src/db.ts` and routes all session, submission, run, and event-stream
// storage through it. Without this module the Node target keeps everything in
// an in-memory SQLite database that is lost on restart; with it, conversation
// history survives restarts and is what the History panel reads back.
//
// `@flue/postgres` is driver-agnostic — it speaks to whatever you wrap in the
// runner shape. Here that driver is porsager `postgres`, configured from the
// DATABASE_URL injected by docker-compose.
const connectionString =
	process.env.DATABASE_URL ?? 'postgres://flue:flue@localhost:5432/flue';

// Keep the pool small: the container runs a single Node process and Postgres
// is the only consumer.
const db = sql(connectionString, { max: 10 });

export default postgres({
	query: (text, params) => db.unsafe(text, params),
	transaction: <T>(fn: (tx: { query: PostgresQuery }) => Promise<T>) =>
		db.begin((tx) => fn({ query: (text, params) => tx.unsafe(text, params) })) as Promise<T>,
	close: () => db.end(),
});
