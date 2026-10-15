import { useState } from 'react'
import type { FormEvent } from 'react'
import { createRoomCode, extractCode, isRoomCode } from '../lib/code'

export function Home({ onEnter }: { onEnter: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState('')

  function join(event: FormEvent) {
    event.preventDefault()
    const next = extractCode(code)
    if (!isRoomCode(next)) {
      setProblem('Enter the 6-character room code.')
      return
    }
    onEnter(next)
  }

  return (
    <main className="home">
      <p className="brand">Roomdrop</p>
      <h1>Hand over the original file.</h1>
      <p className="lede">
        Share a picture, document, PDF, or screenshot with someone in the room. They download their own copy.
        No account and no phone number.
      </p>
      <button className="primary" type="button" onClick={() => onEnter(createRoomCode())}>
        Start a room
      </button>
      <form className="join" onSubmit={join}>
        <label>
          Join with a code
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
              if (problem) setProblem('')
            }}
            placeholder="K7MQ2P"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={80}
          />
        </label>
        <button className="ghost" type="submit">
          Join
        </button>
      </form>
      {problem ? <p className="problem">{problem}</p> : null}
    </main>
  )
}
