// Drizzle migration files are imported as text (see [[rules]] in wrangler.toml).
declare module '*.sql' {
  const content: string
  export default content
}
