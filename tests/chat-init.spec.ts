import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Chat Initialization", () => {
  test("shows init screen for new user without local data", async ({page}) => {
    await signUp(page)

    // Navigate to chats
    await page.goto("/chats")

    // Should show init screen, not chat list
    // Wait for either the init button or checking state
    const initButton = page.getByTestId("chat-init-enable")
    const checkingText = page.getByText("Checking for existing devices...")

    // Either we see the enable button (no remote data) or checking state
    await expect(initButton.or(checkingText)).toBeVisible({timeout: 10000})

    // If checking, wait for it to complete
    if (await checkingText.isVisible()) {
      // Wait for EOSE timeout (5s) + buffer
      await expect(initButton).toBeVisible({timeout: 8000})
    }

    // Verify the init screen content
    await expect(page.getByRole("heading", {name: "Enable Private Messaging"})).toBeVisible()
  })

  test("clicking Enable initializes chat and shows chat UI", async ({page}) => {
    await signUp(page)

    await page.goto("/chats")

    // Wait for init screen
    const initButton = page.getByTestId("chat-init-enable")
    await expect(initButton).toBeVisible({timeout: 10000})

    // Click to enable
    await initButton.click()

    // Should show loading state
    await expect(page.locator(".loading-spinner")).toBeVisible()

    // After init completes, should see chat UI (NewChat tabs)
    await expect(page.getByText("Direct")).toBeVisible({timeout: 10000})
    await expect(page.getByText("Group")).toBeVisible()
    await expect(page.getByText("Public")).toBeVisible()
  })

  test("init state persists after enabling", async ({page}) => {
    await signUp(page)

    await page.goto("/chats")

    // Wait for and click init button
    const initButton = page.getByTestId("chat-init-enable")
    await expect(initButton).toBeVisible({timeout: 10000})
    await initButton.click()

    // Wait for chat UI
    await expect(page.getByText("Direct")).toBeVisible({timeout: 10000})

    // Navigate away and back
    await page.goto("/")
    await page.goto("/chats")

    // Should go directly to chat UI, not init screen
    await expect(page.getByText("Direct")).toBeVisible({timeout: 5000})
    await expect(initButton).not.toBeVisible()
  })

  test("Continue button appears when local data exists", async ({page}) => {
    await signUp(page)

    // First, initialize chat
    await page.goto("/chats")
    const initButton = page.getByTestId("chat-init-enable")
    await expect(initButton).toBeVisible({timeout: 10000})
    await initButton.click()
    await expect(page.getByText("Direct")).toBeVisible({timeout: 10000})

    // Clear the initialized flag but keep local data
    await page.evaluate(() => {
      localStorage.removeItem("chat-initialized")
    })

    // Reload
    await page.reload()

    // Should show "Continue" button since local data exists
    const continueButton = page.getByTestId("chat-init-continue")
    await expect(continueButton).toBeVisible({timeout: 10000})
    await expect(page.getByText("Private Messaging Ready")).toBeVisible()
  })

  test("settings/chat page is always accessible", async ({page}) => {
    await signUp(page)

    // Go directly to settings without initializing chat
    await page.goto("/settings/chat")

    // Should see the chat settings page, not blocked
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})
  })
})
