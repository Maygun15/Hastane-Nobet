/**
 * PLANNING SCREEN COMPONENTS
 * Takvim, Timeline, Task List ve özet gösterimler
 */

import React, { useState, useEffect } from 'react';
import { usePlanning, useTasks } from './api-service';

// ============ TYPEDEFİNİTİONS ============

/**
 * Planning Status Badge
 */
const StatusBadge = ({ status }) => {
  const statusConfig = {
    draft: { color: 'bg-gray-200', text: 'text-gray-800', label: 'Taslak' },
    active: { color: 'bg-blue-200', text: 'text-blue-800', label: 'Aktif' },
    completed: { color: 'bg-green-200', text: 'text-green-800', label: 'Tamamlandı' },
    cancelled: { color: 'bg-red-200', text: 'text-red-800', label: 'İptal' }
  };

  const config = statusConfig[status] || statusConfig.draft;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${config.color} ${config.text}`}>
      {config.label}
    </span>
  );
};

/**
 * Priority Badge
 */
const PriorityBadge = ({ priority }) => {
  const priorityConfig = {
    low: { color: 'bg-green-100', text: 'text-green-800', icon: '▼' },
    medium: { color: 'bg-yellow-100', text: 'text-yellow-800', icon: '●' },
    high: { color: 'bg-orange-100', text: 'text-orange-800', icon: '▲' },
    critical: { color: 'bg-red-100', text: 'text-red-800', icon: '!!!' }
  };

  const config = priorityConfig[priority] || priorityConfig.medium;

  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${config.color} ${config.text}`}>
      {config.icon} {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
};

/**
 * Progress Bar
 */
const ProgressBar = ({ current, total, percentage }) => {
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{current}/{total} tamamlandı</span>
        <span>{percentage}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-green-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
};

// ============ PLANNING CARD ============

export const PlanningCard = ({
  planning,
  onClick,
  onEdit,
  onDelete,
  isSelected
}) => {
  const daysRemaining = Math.ceil(
    (new Date(planning.endDate) - new Date()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div
      onClick={onClick}
      className={`p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h3 className="font-bold text-lg text-gray-800">{planning.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{planning.description}</p>
        </div>
        <div className="flex gap-2">
          <StatusBadge status={planning.status} />
          <PriorityBadge priority={planning.priority} />
        </div>
      </div>

      <div className="mb-3">
        <ProgressBar
          current={planning.metadata.completedTasks}
          total={planning.metadata.totalTasks}
          percentage={planning.metadata.progress}
        />
      </div>

      <div className="flex justify-between items-center text-xs text-gray-600">
        <span>
          {planning.metadata.totalTasks} görev
        </span>
        <span className={daysRemaining <= 7 ? 'text-red-600 font-bold' : ''}>
          {daysRemaining} gün kaldı
        </span>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(planning._id);
          }}
          className="flex-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          Düzenle
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(planning._id);
          }}
          className="flex-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
        >
          Sil
        </button>
      </div>
    </div>
  );
};

// ============ TASK ITEM ============

export const TaskItem = ({
  task,
  onClick,
  onStatusChange,
  onDelete
}) => {
  return (
    <div className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={task.status === 'completed'}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(task._id, e.target.checked ? 'completed' : 'todo');
          }}
          className="mt-1 cursor-pointer"
        />
        <div className="flex-1 cursor-pointer" onClick={onClick}>
          <div className="flex items-center gap-2">
            <h4 className={`font-semibold ${
              task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'
            }`}>
              {task.title}
            </h4>
            <PriorityBadge priority={task.priority} />
          </div>
          <p className="text-xs text-gray-600 mt-1">{task.description}</p>
          
          <div className="flex gap-4 mt-2 text-xs text-gray-600">
            <span>Başlangıç: {new Date(task.startDate).toLocaleDateString('tr-TR')}</span>
            <span>Bitiş: {new Date(task.dueDate).toLocaleDateString('tr-TR')}</span>
            <span>{task.estimatedHours}h tahmini</span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task._id);
          }}
          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
        >
          Sil
        </button>
      </div>
    </div>
  );
};

// ============ PLANNING FORM ============

export const PlanningForm = ({ planning, onSubmit, onCancel, isLoading }) => {
  const [formData, setFormData] = useState(planning || {
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    priority: 'medium',
    status: 'draft'
  });

  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Başlık gereklidir';
    }
    
    if (new Date(formData.startDate) > new Date(formData.endDate)) {
      newErrors.dates = 'Başlangıç tarihi bitiş tarihinden önce olmalıdır';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Hata temizle
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="text-2xl font-bold mb-6">
        {planning ? 'Planlama Düzenle' : 'Yeni Planlama'}
      </h2>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Başlık *
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => handleChange('title', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.title ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Planlama başlığını girin"
        />
        {errors.title && <p className="text-red-600 text-xs mt-1">{errors.title}</p>}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Açıklama
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Planlama hakkında detay ekleyin"
          rows={4}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Başlangıç Tarihi
          </label>
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => handleChange('startDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Bitiş Tarihi
          </label>
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => handleChange('endDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {errors.dates && <p className="text-red-600 text-xs mb-4">{errors.dates}</p>}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Öncelik
          </label>
          <select
            value={formData.priority}
            onChange={(e) => handleChange('priority', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="critical">Kritik</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Durum
          </label>
          <select
            value={formData.status}
            onChange={(e) => handleChange('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="draft">Taslak</option>
            <option value="active">Aktif</option>
            <option value="completed">Tamamlandı</option>
            <option value="cancelled">İptal</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
        >
          İptal
        </button>
      </div>
    </form>
  );
};

// ============ TASK FORM ============

export const TaskForm = ({ task, planningId, onSubmit, onCancel, isLoading }) => {
  const [formData, setFormData] = useState(task || {
    planningId,
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    priority: 'medium',
    estimatedHours: 0,
    status: 'todo'
  });

  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Görev başlığı gereklidir';
    }
    
    if (new Date(formData.startDate) > new Date(formData.dueDate)) {
      newErrors.dates = 'Başlangıç tarihi bitiş tarihinden önce olmalıdır';
    }
    
    if (formData.estimatedHours < 0) {
      newErrors.estimatedHours = 'Tahmini saat negatif olamaz';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="text-2xl font-bold mb-6">
        {task ? 'Görev Düzenle' : 'Yeni Görev'}
      </h2>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Görev Başlığı *
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => handleChange('title', e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.title ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Görev başlığını girin"
        />
        {errors.title && <p className="text-red-600 text-xs mt-1">{errors.title}</p>}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Açıklama
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Görev detayları"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Başlangıç Tarihi
          </label>
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => handleChange('startDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Bitiş Tarihi
          </label>
          <input
            type="date"
            value={formData.dueDate}
            onChange={(e) => handleChange('dueDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {errors.dates && <p className="text-red-600 text-xs mb-4">{errors.dates}</p>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Öncelik
          </label>
          <select
            value={formData.priority}
            onChange={(e) => handleChange('priority', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="critical">Kritik</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Durum
          </label>
          <select
            value={formData.status}
            onChange={(e) => handleChange('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="todo">Yapılacak</option>
            <option value="in-progress">Devam Ediyor</option>
            <option value="review">Gözden Geçir</option>
            <option value="completed">Tamamlandı</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Tahmini Saat
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={formData.estimatedHours}
            onChange={(e) => handleChange('estimatedHours', parseFloat(e.target.value))}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.estimatedHours ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Saat cinsinden"
          />
          {errors.estimatedHours && <p className="text-red-600 text-xs mt-1">{errors.estimatedHours}</p>}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
        >
          İptal
        </button>
      </div>
    </form>
  );
};

// ============ CALENDAR VIEW ============

export const CalendarView = ({ plannings, tasks }) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  
  const days = [];
  
  // Önceki ayın günleri
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const day = new Date(year, month, -i);
    days.push({ date: day, isCurrentMonth: false });
  }
  
  // Bu ayın günleri
  for (let i = 1; i <= daysInMonth; i++) {
    const day = new Date(year, month, i);
    days.push({ date: day, isCurrentMonth: true });
  }
  
  // Sonraki ayın günleri
  const remainingDays = 42 - days.length;
  for (let i = 1; i <= remainingDays; i++) {
    const day = new Date(year, month + 1, i);
    days.push({ date: day, isCurrentMonth: false });
  }
  
  const getEventsForDate = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    const planningEvents = plannings.filter(p => 
      p.startDate.split('T')[0] === dateStr || p.endDate.split('T')[0] === dateStr
    );
    const taskEvents = tasks.filter(t => 
      t.startDate.split('T')[0] === dateStr || t.dueDate.split('T')[0] === dateStr
    );
    return { planningEvents, taskEvents };
  };
  
  const monthName = firstDay.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-xl font-bold mb-4 text-center capitalize">{monthName}</h2>
      
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Pz', 'Pt', 'Ça', 'Ç', 'Pe', 'Ct', 'Pz'].map(day => (
          <div key={day} className="text-center font-semibold text-sm text-gray-600 py-2">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => {
          const { planningEvents, taskEvents } = getEventsForDate(day.date);
          const isToday = day.date.toDateString() === new Date().toDateString();
          
          return (
            <div
              key={idx}
              className={`min-h-20 p-1 border rounded text-xs ${
                day.isCurrentMonth
                  ? isToday
                    ? 'bg-blue-50 border-blue-300'
                    : 'bg-white'
                  : 'bg-gray-50 text-gray-400'
              }`}
            >
              <div className={`font-semibold ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                {day.date.getDate()}
              </div>
              <div className="mt-1">
                {planningEvents.slice(0, 1).map(p => (
                  <div key={p._id} className="bg-blue-100 text-blue-700 px-1 rounded text-xs truncate">
                    {p.title}
                  </div>
                ))}
                {taskEvents.slice(0, 1).map(t => (
                  <div key={t._id} className="bg-green-100 text-green-700 px-1 rounded text-xs truncate">
                    {t.title}
                  </div>
                ))}
                {(planningEvents.length + taskEvents.length) > 2 && (
                  <div className="text-xs text-gray-600">
                    +{planningEvents.length + taskEvents.length - 2}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============ TIMELINE VIEW ============

export const TimelineView = ({ plannings }) => {
  if (plannings.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        Gösterilecek planlama yok
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-xl font-bold mb-6">Timeline</h2>
      
      <div className="space-y-6">
        {plannings.map((planning, idx) => {
          const startDate = new Date(planning.startDate);
          const endDate = new Date(planning.endDate);
          const today = new Date();
          
          const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
          const elapsedDays = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
          const progress = Math.min(Math.max((elapsedDays / totalDays) * 100, 0), 100);
          
          return (
            <div key={idx}>
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-gray-800">{planning.title}</h3>
                <span className="text-xs text-gray-600">
                  {startDate.toLocaleDateString('tr-TR')} - {endDate.toLocaleDateString('tr-TR')}
                </span>
              </div>
              
              <div className="relative h-8 bg-gray-200 rounded-lg overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg"
                  style={{ width: `${progress}%` }}
                ></div>
                
                <div className="absolute inset-0 flex items-center px-3 text-xs font-semibold text-white">
                  {Math.round(progress)}%
                </div>
              </div>
              
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>Başlangıç: {startDate.toLocaleDateString('tr-TR')}</span>
                <span>Bitiş: {endDate.toLocaleDateString('tr-TR')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============ EMPTY STATE ============

export const EmptyState = ({ icon, title, description, action }) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      <p className="text-gray-600 mb-6">{description}</p>
      {action && action}
    </div>
  );
};
