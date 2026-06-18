import { AuthService } from './authService.js'
import { ChatService } from './chatService.js'
import { FollowsService } from './followsService.js'
import { FriendsService } from './friendsService.js'
import { NotificationService } from './notificationService.js'
import { PostsService } from './postsService.js'

export const postsService = new PostsService()
export const authService = new AuthService()
export const chatService = new ChatService()
export const followsService = new FollowsService()
export const friendsService = new FriendsService()
export const notificationService = new NotificationService()