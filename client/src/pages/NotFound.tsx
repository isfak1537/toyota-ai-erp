import { EmptyState, LinkButton } from '../components/ui'

export default function NotFound() {
  return <EmptyState title="Page not found" action={<LinkButton to="/">Back to the dashboard</LinkButton>}>That address does not exist.</EmptyState>
}
