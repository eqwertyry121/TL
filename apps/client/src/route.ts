import type { Route } from "./types";

export function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const [path] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "dish" && parts[1]) return { name: "dish", id: parts[1] };
  if (parts[0] === "cart") return { name: "cart" };
  if (parts[0] === "checkout") return { name: "checkout" };
  if (parts[0] === "order" && parts[1]) return { name: "order", id: parts[1] };
  if (parts[0] === "orders") return { name: "orders" };
  if (parts[0] === "support") return { name: "support" };
  if (parts[0] === "terms") return { name: "terms" };
  return { name: "menu" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "menu":
      return "#/";
    case "dish":
      return `#/dish/${route.id}`;
    case "cart":
      return "#/cart";
    case "checkout":
      return "#/checkout";
    case "order":
      return `#/order/${route.id}`;
    case "orders":
      return "#/orders";
    case "support":
      return "#/support";
    case "terms":
      return "#/terms";
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}

export function replaceRoute(route: Route): void {
  window.location.replace(routeToHash(route));
}
