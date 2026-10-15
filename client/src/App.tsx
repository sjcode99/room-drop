import { useEffect, useState } from 'react'
import { Home } from './pages/Home'
import { Room } from './pages/Room'

export function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function go(next: string) {
    window.history.pushState({}, '', next)
    setPath(next)
  }

  const match = path.match(/^\/r\/([A-Za-z0-9]{6})\/?$/)
  if (match) return <Room code={match[1].toUpperCase()} onLeave={() => go('/')} />
  return <Home onEnter={(code) => go(`/r/${code}`)} />
}
