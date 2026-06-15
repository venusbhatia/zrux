export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#1d1d1f',
        background: '#f5f5f7',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', fontWeight: 600 }}>zrux</h1>
      <p style={{ color: '#6e6e73', marginTop: '0.5rem' }}>
        Your context engine is booting. Phase 0 skeleton is live.
      </p>
    </main>
  )
}
