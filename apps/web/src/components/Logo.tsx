import { Link } from 'react-router-dom';

export function Logo() {
  return (
    <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 font-mono text-xs">
        &lt;/&gt;
      </span>
      CodeSync
    </Link>
  );
}
