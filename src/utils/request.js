import axios from 'axios'
import { message } from 'antd'

// 创建一个简单的缓存系统
const cache = new Map()
const CACHE_TIME = 5 * 60 * 1000 // 缓存5分钟

// 创建请求队列
class RequestQueue {
  constructor() {
    this.queue = []
    this.processing = false
  }

  add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject })
      this.process()
    })
  }

  async process() {
    if (this.processing || this.queue.length === 0) return
    this.processing = true

    const { request, resolve, reject } = this.queue.shift()
    try {
      const response = await request()
      resolve(response)
    } catch (error) {
      reject(error)
    } finally {
      this.processing = false
      this.process()
    }
  }
}

const queue = new RequestQueue()

// 重试函数
const retryRequest = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn()
  } catch (error) {
    if (retries === 0) throw error
    await new Promise(resolve => setTimeout(resolve, delay))
    return retryRequest(fn, retries - 1, delay * 2)
  }
}

// 缓存函数
const withCache = (key, fn, time = CACHE_TIME) => {
  const cached = cache.get(key)
  if (cached && cached.timestamp > Date.now() - time) {
    return Promise.resolve(cached.data)
  }

  return fn().then(data => {
    cache.set(key, { data, timestamp: Date.now() })
    return data
  })
}

// 创建axios实例
const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000', // 设置基础URL
  timeout: 15000, // 请求超时时间
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  config => {
    // 在发送请求之前做些什么
    const token = localStorage.getItem('token')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  error => {
    // 对请求错误做些什么
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  response => {
    // 对响应数据做点什么
    const res = response.data
    
    // 这里可以根据后端的响应结构做相应的处理
    if (res.code !== 200) {
      message.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    
    return res
  },
  error => {
    // 对响应错误做点什么
    console.error('Response error:', error)
    message.error(error.message || '网络错误')
    return Promise.reject(error)
  }
)

// 增强的请求函数
const enhancedRequest = async (config, options = {}) => {
  const { 
    useCache = false, 
    cacheTime = CACHE_TIME,
    useQueue = false,
    retry = false,
    retries = 0,
    retryDelay = 1000
  } = options

  const requestFn = () => request(config)

  let finalRequest = requestFn

  if (retry) {
    finalRequest = () => retryRequest(requestFn, retries, retryDelay)
  }

  if (useCache && (config.method === 'get' || config.method === 'GET')) {
    const cacheKey = `${config.url}${JSON.stringify(config.params || {})}`
    finalRequest = () => withCache(cacheKey, requestFn, cacheTime)
  }

  if (useQueue) {
    return queue.add(finalRequest)
  }

  return finalRequest()
}

export { enhancedRequest as request, cache, queue } 