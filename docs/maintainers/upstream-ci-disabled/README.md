# Inactive inherited CI workflows

The `.yml.txt` files in this directory preserve upstream workflow source for reference. They are not under `.github/workflows/` and GitHub Actions does not execute them. No automatic CI, scheduled provider runs, npm publishing, Cloudflare deployment or registry publication is enabled for this public source distribution.

Earlier disabled release workflows and publishing actions remain in the adjacent `upstream-publishing-disabled/` directory. A future workflow requires its own review of permissions, external actions, dependency lifecycle execution, fork identity and provider prerequisites. The package must remain `private: true` unless a separately authorized registry release is prepared.
