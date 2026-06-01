import { useState, type FormEvent } from 'react';
import { useOrganizers } from '../hooks/useOrganizers';
import { useAuth } from '../auth/useAuth';
import OrganizerItem from './OrganizerItem';

export default function OrganizerList() {
  const { organizers, loading, error, addOrganizer, toggleOrganizer, removeOrganizer } = useOrganizers();
  const { logout } = useAuth();
  const [text, setText] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    await addOrganizer(trimmed);
  }

  return (
    <div className="container">
      <header className="header">
        <h1>Organizers</h1>
        <button className="logout" onClick={logout}>
          Log out
        </button>
      </header>

      <form className="add-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          placeholder="What needs doing?"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && organizers.length === 0 && <p className="empty">Nothing yet. Add a organizer above.</p>}

      <ul className="organizer-list">
        {organizers.map((organizer) => (
          <OrganizerItem key={organizer.id} organizer={organizer} onToggle={toggleOrganizer} onDelete={removeOrganizer} />
        ))}
      </ul>
    </div>
  );
}
