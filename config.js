/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

// Public Configuration (Localhost Default)
const ChatWallConfig = {
    API_URL: "http://localhost:3000",
    // API_URL: "https://chatwall.io",
    ENABLE_DEV_LICENSE_CHECK: true, // Enforce license check in dev by default
};
