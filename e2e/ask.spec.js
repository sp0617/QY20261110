import { expect, test } from '@playwright/test';

test('首页加载并展示服务状态', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/AI 答疑助手/);
  await expect(page.locator('#statusText')).toContainText(/演示模式|在线/);
});

test('提问后展示回答与引用资料', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('输入你的问题').fill('什么是过拟合？如何避免过拟合？');
  await page.getByRole('button', { name: '发送' }).click();

  const answer = page.locator('.message-bot .bubble').last();
  await expect(answer).toContainText('演示模式的预设回答', { timeout: 15_000 });
  await expect(answer).toContainText('过拟合');
  await expect(page.locator('.source').first()).toBeVisible();
});
