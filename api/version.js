export default async function handler(req, res) {
  return res.status(200).json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    mode: 'minimal'
  });
}
