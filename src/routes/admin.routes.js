import express from 'express';
import adminController from '../controllers/admin.controller.js';
import { auth, adminOnly, modOrAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// All admin routes require authentication
router.use(auth);

// Dashboard (admin only)
router.get('/dashboard', adminOnly, adminController.getDashboard);

// User management
router.get('/users', modOrAdmin, adminController.getAllUsers);
router.get('/users/:userId', modOrAdmin, adminController.getUserById);
router.patch('/users/:userId/role', adminOnly, adminController.updateUserRole);
router.patch('/users/:userId/status', modOrAdmin, adminController.updateUserStatus);
router.post('/users/:userId/deactivate', modOrAdmin, adminController.deactivateUser);
router.post('/users/:userId/ban', modOrAdmin, adminController.banUser);
router.post('/users/:userId/reactivate', modOrAdmin, adminController.reactivateUser);
router.delete('/users/:userId', adminOnly, adminController.deleteUser);

export default router;
