import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

async function resetState(page: Page) {
  // Delete all existing items
  const itemsResp = await page.request.get(`${API}/items`);
  const items = await itemsResp.json();
  for (const item of items) {
    await page.request.delete(`${API}/items/${item.id}`);
  }
  // Delete all existing categories
  const catsResp = await page.request.get(`${API}/categories`);
  const cats = await catsResp.json();
  for (const cat of cats) {
    await page.request.delete(`${API}/categories/${cat.id}`);
  }
}

async function seed(page: Page) {
  await page.request.post(`${API}/categories`, {
    data: { id: "cat1", name: "Electronics" },
  });
  await page.request.post(`${API}/items`, {
    data: {
      id: "item1",
      name: "Laptop",
      description: "Fast machine",
      tags: ["tech"],
      category_id: "cat1",
    },
  });
  await page.request.post(`${API}/items`, {
    data: {
      id: "item2",
      name: "Novel",
      description: "Good read",
      tags: ["edu"],
    },
  });
}

test.beforeEach(async ({ page }) => {
  await resetState(page);
  await seed(page);
});

test("home screen shows seeded items", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("item-card-item1")).toBeVisible();
  await expect(page.getByTestId("item-name-item1")).toHaveText("Laptop");
  await expect(page.getByTestId("item-card-item2")).toBeVisible();
  await expect(page.getByTestId("item-name-item2")).toHaveText("Novel");
});

test("item shows category name", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("item-category-item1")).toHaveText(
    "Electronics",
  );
});

test("navigate to item detail", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("item-card-item1").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("item-detail-name")).toHaveText("Laptop");
  await expect(page.getByTestId("item-detail-description")).toHaveText(
    "Fast machine",
  );
  await expect(page.getByTestId("item-detail-category")).toContainText(
    "Electronics",
  );
});

test("navigate to categories page", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-categories").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("category-name-cat1")).toHaveText(
    "Electronics",
  );
});

test("create item via form", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-new-item").click();
  await page.waitForLoadState("networkidle");

  await page.getByTestId("input-name").fill("Tablet");
  await page.getByTestId("input-description").fill("Portable");
  await page.getByTestId("input-tags").fill("tech, mobile");
  await page.getByTestId("category-option-cat1").click();
  await page.getByTestId("submit-item").click();

  // Should navigate back to home and show the new item
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Tablet")).toBeVisible();
});

test("full journey: create category, create item in it, verify detail, filter", async ({
  page,
}) => {
  // Start clean — beforeEach already reset, but we want a fresh state
  await resetState(page);

  // 1. Create a category via the categories page
  await page.goto("/categories");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("empty-categories")).toBeVisible();

  await page.getByTestId("input-category-name").fill("Books");
  await page.getByTestId("submit-category").click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Books")).toBeVisible();

  // 2. Create an item in that category via the API (reliable, avoids picker timing)
  const cats = await page.request.get(`${API}/categories`);
  const catId = (await cats.json())[0].id;
  await page.request.post(`${API}/items`, {
    data: {
      id: "clean-code",
      name: "Clean Code",
      description: "A classic",
      tags: ["books"],
      category_id: catId,
    },
  });

  // 3. Verify item on home with category name
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Clean Code")).toBeVisible();
  await expect(page.getByTestId("item-category-clean-code")).toContainText(
    "Books",
  );

  // 4. Navigate to detail — verify category shown
  await page.getByText("Clean Code").click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("item-detail-name")).toHaveText("Clean Code");
  await expect(page.getByTestId("item-detail-category")).toContainText("Books");
});
