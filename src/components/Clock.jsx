import { useEffect, useState } from 'react'
import './Clock.css'

const TIME_FORMAT = {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
}

const formatTime = (d) => d.toLocaleTimeString('en-IN', TIME_FORMAT)

/**
 * The wall clock in the header, ticking every second.
 *
 * Rendered beside the date on both screens. `aria-live` stays off on purpose:
 * a value that changes every second would otherwise be announced every second
 * and bury everything else a screen reader has to say.
 */
export default function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <time className="clock" role="timer" aria-live="off"
      dateTime={now.toISOString()}>
      {formatTime(now)}
    </time>
  )
}
