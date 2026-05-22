import { io } from 'socket.io-client';
import { create } from 'zustand';
import useAuthStore from './authStore';

const useSocketStore = create((set, get) => ({
  socket: null,
  connect() {
    if (get().socket) return get().socket;
    const token = useAuthStore.getState().token;
    if (!token) return null;
    const s = io(window.location.origin, { auth: { token }, path: '/socket.io' });
    s.on('connect', () => console.log('socket connected'));
    s.on('disconnect', () => console.log('socket disconnected'));
    set({ socket: s });
    return s;
  },
  disconnect() {
    const s = get().socket;
    if (s) { s.disconnect(); set({ socket: null }); }
  },
}));

export default useSocketStore;
