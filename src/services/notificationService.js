export class NotificationService {
  constructor() {
    this.containerId = 'notificationContainer'
  }

  showNotification(title, message, type = 'info', duration = 4000) {
    const container = document.getElementById(this.containerId)
    if (!container) return

    const el = this.createNotificationElement(title, message, type)
    container.appendChild(el)

    setTimeout(() => this.removeNotification(el), duration)

    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body: message, icon: '/LVKOSP-JSX/vite.svg' }) } catch {}
    }
  }

  createNotificationElement(title, message, type) {
    const el = document.createElement('div')
    el.style.background = this.getNotificationColor(type)
    el.style.border = '1px solid rgba(255,255,255,0.12)'
    el.style.borderRadius = '12px'
    el.style.padding = '12px 14px'
    el.style.color = 'white'
    el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)'
    el.style.backdropFilter = 'blur(10px)'
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
    el.style.gap = '6px'

    const t = document.createElement('div')
    t.style.fontWeight = '700'
    t.textContent = title

    const m = document.createElement('div')
    m.style.opacity = '0.95'
    m.textContent = message

    el.appendChild(t)
    el.appendChild(m)
    return el
  }

  removeNotification(el) {
    try {
      el?.remove?.()
    } catch {
    }
  }

  getNotificationColor(type) {
    if (type === 'success') return 'rgba(46, 204, 113, 0.22)'
    if (type === 'error') return 'rgba(231, 76, 60, 0.22)'
    if (type === 'warning') return 'rgba(241, 196, 15, 0.22)'
    return 'rgba(52, 152, 219, 0.22)'
  }
}