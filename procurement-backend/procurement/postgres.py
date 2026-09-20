"""PostgreSQL connection adapter for the existing, parameterized engine queries.

All mutations take the same transaction-scoped advisory lock. This deliberately
preserves the single-writer inventory semantics of the SQLite implementation
across serverless instances. Reads use a repeatable snapshot.
"""
import re


class Row:
    def __init__(self, names, values):
        self.names, self.values = names, values

    def keys(self):
        return self.names

    def __getitem__(self, key):
        return self.values[key if isinstance(key, int) else self.names.index(key)]

    def __iter__(self):
        return iter(self.values)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(names, values)


def translate(sql):
    # Only engine-owned SQL is accepted; preserve quoted string literals.
    pieces = re.split(r"('(?:''|[^'])*')", sql)
    sql = ''.join(piece if i % 2 else piece.replace('?', '%s') for i, piece in enumerate(pieces))
    if sql.startswith('INSERT OR IGNORE INTO '):
        sql = sql.replace('INSERT OR IGNORE INTO ', 'INSERT INTO ', 1) + ' ON CONFLICT DO NOTHING'
    return sql


class PostgresConnection:
    def __init__(self, dsn):
        import psycopg
        self.raw = psycopg.connect(dsn, autocommit=True, prepare_threshold=None,
                                  connect_timeout=10, row_factory=row_factory)
        self.raw.execute('SET search_path TO procurement, pg_catalog')
        self.raw.execute("SET statement_timeout TO '20s'")
        self.raw.execute("SET lock_timeout TO '15s'")

    def execute(self, sql, args=()):
        if sql == 'BEGIN IMMEDIATE':
            self.raw.execute('BEGIN')
            return self.raw.execute('SELECT pg_advisory_xact_lock(186294301, 1)')
        if sql == 'BEGIN':
            return self.raw.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return self.raw.execute(translate(sql), args)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.raw.close()

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.raw.rollback() if kind else self.raw.commit()
        finally:
            self.close()
