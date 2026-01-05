import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Chat Settings - Device Management", () => {
  test("shows current device with Current badge", async ({page}) => {
    await signUp(page)

    // Navigate to chat settings
    await page.goto("/settings/chat")

    // Wait for the chat settings to load
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    // Verify "This Device" section is visible
    await expect(page.getByTestId("this-device-section")).toBeVisible()

    // Verify current device badge is shown
    await expect(page.getByTestId("current-device-badge")).toBeVisible()
    await expect(page.getByTestId("current-device-badge")).toHaveText("Current")

    // Verify device ID is displayed
    await expect(page.getByTestId("device-id")).toBeVisible()
  })

  test("current device has edit button but no delete button", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    // Within the "This Device" section, there should be an edit button
    const thisDeviceSection = page.getByTestId("this-device-section")
    await expect(thisDeviceSection.getByTestId("device-edit-button")).toBeVisible()

    // But no delete button for the current device
    await expect(thisDeviceSection.getByTestId("device-delete-button")).not.toBeVisible()
  })

  test("can edit current device label", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    const thisDeviceSection = page.getByTestId("this-device-section")
    await expect(thisDeviceSection).toBeVisible({timeout: 10000})

    // Wait for device to load
    const editButton = thisDeviceSection.getByTestId("device-edit-button")
    await expect(editButton).toBeVisible({timeout: 10000})

    // Click edit button
    await editButton.click()

    // Edit form should appear
    await expect(page.getByTestId("device-edit-form")).toBeVisible()

    // Clear and type new label
    const labelInput = page.getByTestId("device-label-input")
    await labelInput.clear()
    await labelInput.fill("My Test Device")

    // Save the label
    await page.getByTestId("device-label-save").click()

    // Edit form should disappear
    await expect(page.getByTestId("device-edit-form")).not.toBeVisible({timeout: 5000})

    // New label should be visible
    await expect(thisDeviceSection.getByTestId("device-label")).toHaveText(
      "My Test Device"
    )
  })

  test("can cancel device label editing", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    const thisDeviceSection = page.getByTestId("this-device-section")
    await expect(thisDeviceSection).toBeVisible({timeout: 10000})

    // Wait for device to load and get the original device ID (shown when there's no label)
    const deviceIdLocator = thisDeviceSection.getByTestId("device-id")
    await expect(deviceIdLocator).toBeVisible({timeout: 10000})
    const originalId = await deviceIdLocator.textContent()

    // Click edit button
    const editButton = thisDeviceSection.getByTestId("device-edit-button")
    await expect(editButton).toBeVisible({timeout: 10000})
    await editButton.click()

    // Edit form should appear
    await expect(page.getByTestId("device-edit-form")).toBeVisible()

    // Type a new label
    const labelInput = page.getByTestId("device-label-input")
    await labelInput.clear()
    await labelInput.fill("Should Not Be Saved")

    // Cancel the edit
    await page.getByTestId("device-label-cancel").click()

    // Edit form should disappear
    await expect(page.getByTestId("device-edit-form")).not.toBeVisible()

    // Device ID should still be shown (no label saved)
    await expect(thisDeviceSection.getByTestId("device-id")).toHaveText(originalId!)
  })

  test("can edit label using Enter key", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    const thisDeviceSection = page.getByTestId("this-device-section")

    // Click edit button
    await thisDeviceSection.getByTestId("device-edit-button").click()

    // Clear and type new label, then press Enter
    const labelInput = page.getByTestId("device-label-input")
    await labelInput.clear()
    await labelInput.fill("Enter Key Device")
    await labelInput.press("Enter")

    // Edit form should disappear
    await expect(page.getByTestId("device-edit-form")).not.toBeVisible({timeout: 5000})

    // New label should be visible
    await expect(thisDeviceSection.getByTestId("device-label")).toHaveText(
      "Enter Key Device"
    )
  })

  test("can cancel edit using Escape key", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    const thisDeviceSection = page.getByTestId("this-device-section")
    await expect(thisDeviceSection).toBeVisible({timeout: 10000})

    // Wait for device to load
    const editButton = thisDeviceSection.getByTestId("device-edit-button")
    await expect(editButton).toBeVisible({timeout: 10000})

    // Click edit button
    await editButton.click()

    // Type something and press Escape
    const labelInput = page.getByTestId("device-label-input")
    await labelInput.fill("Should Be Cancelled")
    await labelInput.press("Escape")

    // Edit form should disappear
    await expect(page.getByTestId("device-edit-form")).not.toBeVisible()
  })

  // Skip: Label persistence requires relay data persistence which test relay doesn't guarantee
  test.skip("device label persists after page refresh", async ({page}) => {
    await signUp(page)

    await page.goto("/settings/chat")
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    // Wait for the device section to be fully loaded
    const thisDeviceSection = page.getByTestId("this-device-section")
    await expect(thisDeviceSection).toBeVisible({timeout: 10000})
    await expect(thisDeviceSection.getByTestId("device-edit-button")).toBeVisible({
      timeout: 10000,
    })

    // Edit and save a label
    await thisDeviceSection.getByTestId("device-edit-button").click()
    const labelInput = page.getByTestId("device-label-input")
    await labelInput.clear()
    await labelInput.fill("Persistent Label")
    await page.getByTestId("device-label-save").click()

    // Wait for save to complete
    await expect(page.getByTestId("device-edit-form")).not.toBeVisible({timeout: 5000})

    // Refresh the page
    await page.reload()

    // Wait for chat settings to load again
    await expect(page.getByTestId("chat-settings")).toBeVisible({timeout: 10000})

    // Verify the label persisted
    await expect(
      page.getByTestId("this-device-section").getByTestId("device-label")
    ).toHaveText("Persistent Label")
  })

  test("shows signed out message when not logged in", async ({page}) => {
    // Navigate directly without signing in
    await page.goto("/settings/chat")

    // Should show signed out message
    await expect(page.getByTestId("chat-settings-signed-out")).toBeVisible({
      timeout: 10000,
    })
    await expect(
      page.getByText("Please sign in to manage your chat settings")
    ).toBeVisible()
  })
})
