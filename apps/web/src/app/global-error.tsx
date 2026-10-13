'use client';

// Last-resort boundary: replaces the root layout, so it carries its own <html> and minimal styling.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', textAlign: 'center' }}
      >
        <h1 style={{ fontSize: '1.25rem' }}>Something went wrong</h1>
        <p style={{ color: '#555' }}>The app hit an unexpected problem.</p>
        <button
          onClick={reset}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            borderRadius: '0.75rem',
            border: '1px solid #ccc',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
