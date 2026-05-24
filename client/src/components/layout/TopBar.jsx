import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/auth/AuthContext.jsx'

const ROLE_VARIANT = {
  admin: 'destructive',
  developer: 'default',
  viewer: 'secondary',
}

export default function TopBar() {
  const { user, role } = useAuth()

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-card shrink-0">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <span className="text-foreground font-medium">AI Converter</span>
      </nav>

      <div className="flex items-center gap-2">
        {role && (
          <Badge variant={ROLE_VARIANT[role] ?? 'secondary'} className="text-xs capitalize">
            {role}
          </Badge>
        )}
        {user && (
          <span className="text-xs text-muted-foreground hidden sm:block">{user.name}</span>
        )}
      </div>
    </header>
  )
}
