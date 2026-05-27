import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutGrid, GitFork, Users, Settings, LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext.jsx'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

function NavIcon({ to, icon: Icon, label }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <NavLink
            to={to}
            className={({ isActive }) =>
              `flex items-center justify-center w-10 h-10 rounded-lg transition-colors
               ${isActive
                 ? 'bg-primary text-primary-foreground'
                 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
               }`
            }
          />
        }
      >
        <Icon size={18} />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export default function Sidebar() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <aside className="flex flex-col items-center w-14 border-r border-border bg-card py-3 gap-1 shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-center w-10 h-10 mb-1 text-primary font-bold text-lg">
        ⬡
      </div>

      <Separator className="my-1 w-8" />

      {/* Main nav */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        <NavIcon to="/projects" icon={LayoutGrid} label="Projects" />
        <NavIcon to="/graph" icon={GitFork} label="Graph" />

        {role === 'admin' && (
          <>
            <Separator className="my-1 w-8" />
            <NavIcon to="/admin/users" icon={Users} label="Users" />
            <NavIcon to="/admin/settings" icon={Settings} label="Settings" />
          </>
        )}
      </nav>

      {/* Bottom: avatar + logout */}
      <div className="flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={handleLogout}
                className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              />
            }
          >
            <LogOut size={16} />
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  `flex items-center justify-center w-10 h-10 rounded-lg transition-colors
                   ${isActive ? 'ring-2 ring-primary' : 'hover:bg-accent'}`
                }
              />
            }
          >
            <Avatar className="w-8 h-8">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="text-xs">
              <p className="font-medium">{user?.name}</p>
              <p className="text-muted-foreground">{user?.email}</p>
              <p className="text-muted-foreground capitalize">{role}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
