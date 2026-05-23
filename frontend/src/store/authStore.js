import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(persist(
  (set) => ({
    token: null,
    user: null,
    company: null,
    companies: [],  // lista de empresas que o user pertence
    setAuth: ({ token, user, company, companies }) => set({
      token, user, company,
      companies: companies !== undefined ? companies : undefined,
    }),
    setCompanies: (companies) => set({ companies }),
    setActiveCompany: ({ token, company, user }) => set({ token, company, user }),
    logout: () => set({ token: null, user: null, company: null, companies: [] }),
  }),
  { name: 'chat-inunda-auth' }
));

export default useAuthStore;
