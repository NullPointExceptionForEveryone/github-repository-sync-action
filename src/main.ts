import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // 从变量中获取源和目标仓库的URL列表，并过滤掉空行
    const sourceRepositoryUrlList = core
      .getInput('source_repository_url_list')
      .split('\n')
      .filter(Boolean)
    const targetRepositoryUrlList = core
      .getInput('target_repository_url_list')
      .split('\n')
      .filter(Boolean)

    // 检查是否有重复的 URL
    const uniqueSourceUrls = new Set(sourceRepositoryUrlList)
    if (uniqueSourceUrls.size !== sourceRepositoryUrlList.length) {
      throw new Error('Duplicate URLs found in source repository list.')
    }

    // 从秘密中获取源和目标仓库的用户名和密码
    const sourceUsername = core.getInput('source_repository_username')
    const sourcePassword = core.getInput('source_repository_password')
    const targetUsername = core.getInput('target_repository_username')
    const targetPassword = core.getInput('target_repository_password')

    // 检查源和目标仓库列表的长度是否一致
    if (sourceRepositoryUrlList.length !== targetRepositoryUrlList.length) {
      throw new Error(
        'Source and target repository lists must have the same length.'
      )
    }

    // 并发地同步每对仓库
    await Promise.all(
      sourceRepositoryUrlList.map(async (sourceUrl, index) => {
        const targetUrl = targetRepositoryUrlList[index]
        const repoName = path.basename(sourceUrl, '.git') // 获取仓库名
        const cloneDir = path.join(process.cwd(), repoName) // 定义克隆目录

        // 检查 cloneDir 是否存在
        if (fs.existsSync(cloneDir)) {
          core.info(
            `Directory ${cloneDir} already exists. Skipping synchronization for ${sourceUrl}.`
          )
          return
        }

        // 克隆源仓库
        let finalSourceUrl = sourceUrl
        if (sourceUsername && sourcePassword) {
          // 如果提供了用户名和密码，则将其添加到URL中
          finalSourceUrl = sourceUrl.replace(
            'https://',
            `https://${sourceUsername}:${sourcePassword}@`
          )
        }
        await exec.exec('git', ['clone', finalSourceUrl, cloneDir], {
          env: {
            ...process.env,
            GIT_ASKPASS: 'echo', // 禁用密码提示
            GIT_USERNAME: sourceUsername,
            GIT_PASSWORD: sourcePassword
          }
        })

        // 设置目标仓库的远程URL
        let finalTargetUrl = targetUrl
        if (targetUsername && targetPassword) {
          // 如果提供了用户名和密码，则将其添加到URL中
          finalTargetUrl = targetUrl.replace(
            'https://',
            `https://${targetUsername}:${targetPassword}@`
          )
        }
        await exec.exec(
          'git',
          ['remote', 'set-url', 'origin', finalTargetUrl],
          { cwd: cloneDir }
        )

        // 推送所有分支到目标仓库
        await exec.exec('git', ['push', '--all'], {
          cwd: cloneDir,
          env: {
            ...process.env,
            GIT_ASKPASS: 'echo',
            GIT_USERNAME: targetUsername,
            GIT_PASSWORD: targetPassword
          }
        })

        // 推送所有标签到目标仓库
        await exec.exec('git', ['push', '--tags'], {
          cwd: cloneDir,
          env: {
            ...process.env,
            GIT_ASKPASS: 'echo',
            GIT_USERNAME: targetUsername,
            GIT_PASSWORD: targetPassword
          }
        })

        // 删除克隆的目录以清理空间
        fs.rmSync(cloneDir, { recursive: true, force: true })
      })
    )

    // 如果所有仓库同步成功，记录信息
    core.info('All repositories have been synchronized successfully.')
  } catch (error) {
    // 如果发生错误，设置工作流失败
    core.setFailed(`Action failed with error: ${error}`)
  }
}
