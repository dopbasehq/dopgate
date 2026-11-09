import { createRouter, createWebHistory } from "vue-router";
import { guard } from "./router.guards";

/** Route table for the dopgate admin console. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: { name: "users" } },
    {
      path: "/setup",
      name: "setup",
      component: () => import("~/pages/Setup/Setup.page.vue"),
      meta: { public: true },
    },
    {
      path: "/sign-in",
      name: "sign-in",
      component: () => import("~/pages/SignIn/SignIn.page.vue"),
      meta: { public: true, guestOnly: true },
    },
    {
      path: "/no-access",
      name: "no-access",
      component: () => import("~/pages/NoAccess/NoAccess.page.vue"),
    },
    {
      path: "/users",
      name: "users",
      component: () => import("~/pages/Users/Users.page.vue"),
    },
    {
      path: "/users/:id",
      name: "user",
      component: () => import("~/pages/User/User.page.vue"),
    },
    {
      path: "/templates",
      name: "templates",
      component: () => import("~/pages/Templates/Templates.page.vue"),
    },
    {
      path: "/templates/:name",
      name: "template",
      component: () => import("~/pages/Template/Template.page.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("~/pages/Settings/Settings.page.vue"),
    },
    {
      path: "/keys",
      name: "keys",
      component: () => import("~/pages/Keys/Keys.page.vue"),
    },
    {
      path: "/audit",
      name: "audit",
      component: () => import("~/pages/Audit/Audit.page.vue"),
    },
    {
      path: "/account",
      name: "account",
      component: () => import("~/pages/Account/Account.page.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("~/pages/NotFound/NotFound.page.vue"),
      meta: { public: true },
    },
  ],
});

router.beforeEach(guard);
