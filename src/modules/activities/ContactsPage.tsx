import CrmPage from '@/modules/crm/CrmPage'

// 复用原分组与列表，避免个人入口另起一套视觉和维护口径。
export default function ContactsPage() {
  return <CrmPage personal />
}
