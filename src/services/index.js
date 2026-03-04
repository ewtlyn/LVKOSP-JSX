import { AuthService } from './authService.js'
import { ChatService } from './chatService.js'
import { FriendsService } from './friendsService.js'
import { NotificationService } from './notificationService.js'

export const authService = new AuthService()
export const chatService = new ChatService()
export const friendsService = new FriendsService()
export const notificationService = new NotificationService()