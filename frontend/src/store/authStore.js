import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(persist(
  (set) => ({
    token: null,
    user: null,
    company: null,
    setAuth: ({ token, user, company }) => set({ token, user, company }),
    logout: () => set({ token: null, user: null, company: null }),
  }),
  { name: 'chat-inunda-auth' }
));

export default useAuthStore;
