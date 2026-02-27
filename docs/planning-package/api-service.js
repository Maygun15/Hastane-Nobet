/**
 * API SERVICE - Frontend ile Backend iletişim
 * Sağlam hata yönetimi, retry logic, request/response intercepting
 */

import axios from 'axios';

// ============ API CLIENT SETUP ============

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Unique request ID oluştur (debugging için)
const generateRequestId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// ============ REQUEST INTERCEPTOR ============

apiClient.interceptors.request.use(
  (config) => {
    // Request ID ekle
    config.headers['X-Request-ID'] = generateRequestId();
    
    // User ID ekle (varsa)
    const userId = localStorage.getItem('userId');
    if (userId) {
      config.headers['User-Id'] = userId;
    }
    
    // Token ekle (varsa)
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    console.log(`📤 API Request: ${config.method.toUpperCase()} ${config.url}`, {
      requestId: config.headers['X-Request-ID'],
      data: config.data
    });
    
    return config;
  },
  (error) => {
    console.error('❌ Request interceptor hatası:', error);
    return Promise.reject(error);
  }
);

// ============ RESPONSE INTERCEPTOR ============

apiClient.interceptors.response.use(
  (response) => {
    const { data } = response;
    
    console.log(`📥 API Response: ${response.config.method.toUpperCase()} ${response.config.url}`, {
      statusCode: response.status,
      requestId: response.config.headers['X-Request-ID'],
      success: data.success
    });
    
    return response;
  },
  (error) => {
    const requestId = error.config?.headers?.['X-Request-ID'];
    
    // Network error
    if (!error.response) {
      console.error('🌐 Network Hatası:', {
        requestId,
        message: error.message,
        url: error.config?.url
      });
      
      return Promise.reject({
        type: 'NETWORK_ERROR',
        message: 'İnternet bağlantısı başarısız. Lütfen bağlantınızı kontrol edin.',
        requestId,
        originalError: error
      });
    }
    
    // Server response error
    const { status, data: responseData } = error.response;
    
    console.error(`❌ API Error: ${error.config.method.toUpperCase()} ${error.config.url}`, {
      statusCode: status,
      requestId,
      error: responseData.error
    });
    
    return Promise.reject({
      type: 'API_ERROR',
      statusCode: status,
      code: responseData.error?.code || 'UNKNOWN_ERROR',
      message: responseData.error?.message || 'Bir hata oluştu',
      details: responseData.error?.details || [],
      requestId,
      originalError: error
    });
  }
);

// ============ API SERVICES ============

/**
 * PLANNING SERVİCES
 */
export const planningService = {
  // Tüm planlamaları listele
  list: async (params = {}) => {
    try {
      const response = await apiClient.get('/api/v1/planning', { params });
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Belirli planlama detayları
  getById: async (id) => {
    try {
      const response = await apiClient.get(`/api/v1/planning/${id}`);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Yeni planlama oluştur
  create: async (planningData) => {
    try {
      const response = await apiClient.post('/api/v1/planning', planningData);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Planlama güncelle
  update: async (id, planningData) => {
    try {
      const response = await apiClient.put(`/api/v1/planning/${id}`, planningData);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Planlama sil
  delete: async (id) => {
    try {
      const response = await apiClient.delete(`/api/v1/planning/${id}`);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  }
};

/**
 * TASK SERVİCES
 */
export const taskService = {
  // Görevleri listele
  list: async (params = {}) => {
    try {
      const response = await apiClient.get('/api/v1/tasks', { params });
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Belirli görev detayları
  getById: async (id) => {
    try {
      const response = await apiClient.get(`/api/v1/tasks/${id}`);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Yeni görev oluştur
  create: async (taskData) => {
    try {
      const response = await apiClient.post('/api/v1/tasks', taskData);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Görev güncelle
  update: async (id, taskData) => {
    try {
      const response = await apiClient.put(`/api/v1/tasks/${id}`, taskData);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Görev durumu değiştir
  updateStatus: async (id, status) => {
    try {
      const response = await apiClient.patch(`/api/v1/tasks/${id}/status`, { status });
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  },

  // Görev sil
  delete: async (id) => {
    try {
      const response = await apiClient.delete(`/api/v1/tasks/${id}`);
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message
        };
      }
      throw new Error(response.data.error?.message);
    } catch (error) {
      throw handleApiError(error);
    }
  }
};

// ============ ERROR HANDLER ============

const handleApiError = (error) => {
  // Eğer zaten işlenmiş bir hata ise direkt döndür
  if (error.type === 'NETWORK_ERROR' || error.type === 'API_ERROR') {
    return error;
  }

  // Diğer hatalar
  console.error('Unhandled API error:', error);
  return {
    type: 'UNKNOWN_ERROR',
    message: 'Bilinmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
    originalError: error
  };
};

// ============ CUSTOM HOOKS ============

import { useState, useCallback } from 'react';

/**
 * usePlanning - Planlama verilerini yönet
 */
export const usePlanning = () => {
  const [plannings, setPlannings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPlannings = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await planningService.list(params);
      if (result.success) {
        setPlannings(result.data.plannings);
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlanningById = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const result = await planningService.getById(id);
      if (result.success) {
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createPlanning = useCallback(async (planningData) => {
    setLoading(true);
    setError(null);
    try {
      const result = await planningService.create(planningData);
      if (result.success) {
        setPlannings(prev => [result.data, ...prev]);
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePlanning = useCallback(async (id, planningData) => {
    setLoading(true);
    setError(null);
    try {
      const result = await planningService.update(id, planningData);
      if (result.success) {
        setPlannings(prev => 
          prev.map(p => p._id === id ? result.data : p)
        );
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deletePlanning = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const result = await planningService.delete(id);
      if (result.success) {
        setPlannings(prev => prev.filter(p => p._id !== id));
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    plannings,
    loading,
    error,
    fetchPlannings,
    fetchPlanningById,
    createPlanning,
    updatePlanning,
    deletePlanning
  };
};

/**
 * useTasks - Görev verilerini yönet
 */
export const useTasks = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTasks = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await taskService.list(params);
      if (result.success) {
        setTasks(result.data.tasks);
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTaskById = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const result = await taskService.getById(id);
      if (result.success) {
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(async (taskData) => {
    setLoading(true);
    setError(null);
    try {
      const result = await taskService.create(taskData);
      if (result.success) {
        setTasks(prev => [result.data, ...prev]);
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTask = useCallback(async (id, taskData) => {
    setLoading(true);
    setError(false);
    try {
      const result = await taskService.update(id, taskData);
      if (result.success) {
        setTasks(prev => 
          prev.map(t => t._id === id ? result.data : t)
        );
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTaskStatus = useCallback(async (id, status) => {
    setLoading(true);
    setError(null);
    try {
      const result = await taskService.updateStatus(id, status);
      if (result.success) {
        setTasks(prev => 
          prev.map(t => t._id === id ? result.data : t)
        );
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteTask = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const result = await taskService.delete(id);
      if (result.success) {
        setTasks(prev => prev.filter(t => t._id !== id));
        return result.data;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    fetchTaskById,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask
  };
};

export default apiClient;
