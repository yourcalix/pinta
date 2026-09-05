'use strict';

const PREVIEW_PATHS = Object.freeze({
  '/assets/images/profile/profile-default-cover.webp': '/assets/images/profile/profile-default-cover-preview.jpg',
  '/assets/images/profile/profile-avatar-male-painted.webp': '/assets/images/profile/profile-avatar-male-painted-preview.jpg',
  '/assets/images/profile/profile-avatar-female-painted.webp': '/assets/images/profile/profile-avatar-female-painted-preview.jpg',
  '/assets/images/profile/profile-avatar-neutral-painted.webp': '/assets/images/profile/profile-avatar-neutral-painted-preview.jpg'
});

function profileImagePreviewPath(displayPath) {
  return PREVIEW_PATHS[displayPath] || '';
}

module.exports = {
  PREVIEW_PATHS,
  profileImagePreviewPath
};
