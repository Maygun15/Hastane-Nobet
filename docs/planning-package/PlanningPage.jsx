/**
 * PLANNING PAGE - Ana Planlama Ekranı
 * Tüm bileşenleri entegre eden tam fonksiyonel sayfa
 */

import React, { useState, useEffect } from 'react';
import { usePlanning, useTasks } from './api-service';
import {
  PlanningCard,
  TaskItem,
  PlanningForm,
  TaskForm,
  CalendarView,
  TimelineView,
  EmptyState,
  StatusBadge,
  PriorityBadge
} from './planning-components';

// ============ TOAST NOTIFICATION ============

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500'
  }[type] || 'bg-gray-500';

  return (
    <div className={`fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg`}>
      {message}
    </div>
  );
};

// ============ MAIN PLANNING PAGE ============

export const PlanningPage = () => {
  // State Yönetimi
  const [view, setView] = useState('list'); // list, calendar, timeline
  const [selectedPlanning, setSelectedPlanning] = useState(null);
  const [showPlanningForm, setShowPlanningForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    searchTerm: ''
  });
  const [toast, setToast] = useState(null);

  // API Hooks
  const {
    plannings,
    loading: planningLoading,
    error: planningError,
    fetchPlannings,
    fetchPlanningById,
    createPlanning,
    updatePlanning,
    deletePlanning
  } = usePlanning();

  const {
    tasks,
    loading: taskLoading,
    error: taskError,
    fetchTasks,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask
  } = useTasks();

  // İlk yüklemede verileri al
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([
        fetchPlannings(filters),
        fetchTasks(selectedPlanning ? { planningId: selectedPlanning._id } : {})
      ]);
    } catch (error) {
      showToast('Veriler yüklenirken hata oluştu', 'error');
    }
  };

  // Toast göster
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Planlama seç
  const handleSelectPlanning = async (planning) => {
    setSelectedPlanning(planning);
    try {
      const updated = await fetchPlanningById(planning._id);
      setSelectedPlanning(updated);
    } catch (error) {
      showToast('Planlama yüklenirken hata oluştu', 'error');
    }
  };

  // Planlama oluştur/güncelle
  const handleSavePlanning = async (data) => {
    try {
      if (editingPlanning) {
        await updatePlanning(editingPlanning._id, data);
        showToast('Planlama başarıyla güncellendi', 'success');
      } else {
        await createPlanning(data);
        showToast('Planlama başarıyla oluşturuldu', 'success');
      }
      setShowPlanningForm(false);
      setEditingPlanning(null);
    } catch (error) {
      showToast(error.message || 'Planlama kaydedilemedi', 'error');
    }
  };

  // Planlama sil
  const handleDeletePlanning = async (id) => {
    if (window.confirm('Bu planlama silinecek. Devam etmek istediğinize emin misiniz?')) {
      try {
        await deletePlanning(id);
        if (selectedPlanning?._id === id) {
          setSelectedPlanning(null);
        }
        showToast('Planlama başarıyla silindi', 'success');
      } catch (error) {
        showToast('Planlama silinirken hata oluştu', 'error');
      }
    }
  };

  // Görev oluştur/güncelle
  const handleSaveTask = async (data) => {
    try {
      if (editingTask) {
        await updateTask(editingTask._id, data);
        showToast('Görev başarıyla güncellendi', 'success');
      } else {
        await createTask(data);
        showToast('Görev başarıyla oluşturuldu', 'success');
      }
      setShowTaskForm(false);
      setEditingTask(null);
      
      // Planlama verilerini yenile
      if (selectedPlanning) {
        await fetchPlanningById(selectedPlanning._id);
      }
    } catch (error) {
      showToast(error.message || 'Görev kaydedilemedi', 'error');
    }
  };

  // Görev sil
  const handleDeleteTask = async (id) => {
    if (window.confirm('Bu görev silinecek. Devam etmek istediğinize emin misiniz?')) {
      try {
        await deleteTask(id);
        showToast('Görev başarıyla silindi', 'success');
        
        // Planlama verilerini yenile
        if (selectedPlanning) {
          await fetchPlanningById(selectedPlanning._id);
        }
      } catch (error) {
        showToast('Görev silinirken hata oluştu', 'error');
      }
    }
  };

  // Görev durumu değiştir
  const handleUpdateTaskStatus = async (taskId, status) => {
    try {
      await updateTaskStatus(taskId, status);
      showToast('Görev durumu güncellendi', 'success');
      
      // Planlama verilerini yenile
      if (selectedPlanning) {
        await fetchPlanningById(selectedPlanning._id);
      }
    } catch (error) {
      showToast('Durum güncellenirken hata oluştu', 'error');
    }
  };

  // Filtrelenmiş planlamalar
  const filteredPlannings = plannings.filter(planning => {
    const matchesStatus = !filters.status || planning.status === filters.status;
    const matchesPriority = !filters.priority || planning.priority === filters.priority;
    const matchesSearch = !filters.searchTerm || 
      planning.title.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      planning.description.toLowerCase().includes(filters.searchTerm.toLowerCase());
    
    return matchesStatus && matchesPriority && matchesSearch;
  });

  // Seçili planlamaya ait görevler
  const selectedPlanningTasks = selectedPlanning
    ? tasks.filter(task => task.planningId === selectedPlanning._id)
    : [];

  const isLoading = planningLoading || taskLoading;

  // ============ RENDER ============

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Planlama Yönetimi</h1>
              <p className="text-gray-600 mt-1">Projelerinizi ve görevlerinizi etkili bir şekilde yönetin</p>
            </div>
            <button
              onClick={() => {
                setEditingPlanning(null);
                setShowPlanningForm(true);
              }}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              + Yeni Planlama
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* View Toggle ve Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* View Selection */}
            <div className="flex gap-2">
              <button
                onClick={() => setView('list')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  view === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📋 Liste
              </button>
              <button
                onClick={() => setView('calendar')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  view === 'calendar'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📅 Takvim
              </button>
              <button
                onClick={() => setView('timeline')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  view === 'timeline'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📊 Timeline
              </button>
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Planlamada ara..."
              value={filters.searchTerm}
              onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* Filter Selects */}
            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tüm Durumlar</option>
              <option value="draft">Taslak</option>
              <option value="active">Aktif</option>
              <option value="completed">Tamamlandı</option>
              <option value="cancelled">İptal</option>
            </select>

            <select
              value={filters.priority}
              onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tüm Öncelikler</option>
              <option value="low">Düşük</option>
              <option value="medium">Orta</option>
              <option value="high">Yüksek</option>
              <option value="critical">Kritik</option>
            </select>
          </div>
        </div>

        {/* Planlamalar Formu */}
        {showPlanningForm && (
          <div className="mb-6">
            <PlanningForm
              planning={editingPlanning}
              onSubmit={handleSavePlanning}
              onCancel={() => {
                setShowPlanningForm(false);
                setEditingPlanning(null);
              }}
              isLoading={planningLoading}
            />
          </div>
        )}

        {/* Hata Mesajları */}
        {planningError && (
          <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700">
            <strong>Hata:</strong> {planningError.message}
          </div>
        )}

        {/* İçerik */}
        {isLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="inline-block">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
            <p className="mt-4 text-gray-600">Veriler yükleniyor...</p>
          </div>
        ) : filteredPlannings.length === 0 ? (
          <EmptyState
            icon="📋"
            title="Planlama bulunamadı"
            description="Henüz hiç planlama oluşturulmadı. Yeni planlama oluşturarak başlayın."
            action={
              <button
                onClick={() => setShowPlanningForm(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
              >
                + Yeni Planlama Oluştur
              </button>
            }
          />
        ) : view === 'list' ? (
          // Liste Görünümü
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Planlama Listesi */}
            <div className="lg:col-span-1">
              <h2 className="text-xl font-bold mb-4">Planlamalar ({filteredPlannings.length})</h2>
              <div className="space-y-4">
                {filteredPlannings.map(planning => (
                  <PlanningCard
                    key={planning._id}
                    planning={planning}
                    isSelected={selectedPlanning?._id === planning._id}
                    onClick={() => handleSelectPlanning(planning)}
                    onEdit={(id) => {
                      const plan = filteredPlannings.find(p => p._id === id);
                      setEditingPlanning(plan);
                      setShowPlanningForm(true);
                    }}
                    onDelete={handleDeletePlanning}
                  />
                ))}
              </div>
            </div>

            {/* Seçili Planlamanın Görevleri */}
            <div className="lg:col-span-2">
              {selectedPlanning ? (
                <div>
                  {/* Planlama Detayları */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900">{selectedPlanning.title}</h2>
                        <p className="text-gray-600 mt-2">{selectedPlanning.description}</p>
                      </div>
                      <div className="flex gap-2">
                        <StatusBadge status={selectedPlanning.status} />
                        <PriorityBadge priority={selectedPlanning.priority} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-gray-600">Başlangıç</p>
                        <p className="font-semibold">
                          {new Date(selectedPlanning.startDate).toLocaleDateString('tr-TR')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Bitiş</p>
                        <p className="font-semibold">
                          {new Date(selectedPlanning.endDate).toLocaleDateString('tr-TR')}
                        </p>
                      </div>
                    </div>

                    <div className="mb-4">
                      <p className="text-xs text-gray-600 mb-2">İlerleme</p>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className="bg-green-500 h-3 rounded-full"
                          style={{
                            width: `${selectedPlanning.metadata.progress}%`
                          }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        {selectedPlanning.metadata.completedTasks}/{selectedPlanning.metadata.totalTasks} tamamlandı
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingPlanning(selectedPlanning);
                          setShowPlanningForm(true);
                        }}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
                      >
                        Düzenle
                      </button>
                      <button
                        onClick={() => {
                          setEditingTask(null);
                          setShowTaskForm(true);
                        }}
                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
                      >
                        + Görev Ekle
                      </button>
                    </div>
                  </div>

                  {/* Görev Formu */}
                  {showTaskForm && (
                    <div className="mb-6">
                      <TaskForm
                        task={editingTask}
                        planningId={selectedPlanning._id}
                        onSubmit={handleSaveTask}
                        onCancel={() => {
                          setShowTaskForm(false);
                          setEditingTask(null);
                        }}
                        isLoading={taskLoading}
                      />
                    </div>
                  )}

                  {/* Görevler */}
                  <h3 className="text-xl font-bold mb-4">Görevler ({selectedPlanningTasks.length})</h3>
                  {selectedPlanningTasks.length === 0 ? (
                    <EmptyState
                      icon="✓"
                      title="Görev yok"
                      description="Bu planlamaya ait görev bulunmamaktadır."
                      action={
                        <button
                          onClick={() => setShowTaskForm(true)}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
                        >
                          + Görev Ekle
                        </button>
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {selectedPlanningTasks.map(task => (
                        <TaskItem
                          key={task._id}
                          task={task}
                          onClick={() => {
                            setEditingTask(task);
                            setShowTaskForm(true);
                          }}
                          onStatusChange={handleUpdateTaskStatus}
                          onDelete={handleDeleteTask}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon="👈"
                  title="Planlama seçin"
                  description="Detayları görmek için sol taraftan bir planlama seçin"
                />
              )}
            </div>
          </div>
        ) : view === 'calendar' ? (
          // Takvim Görünümü
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CalendarView plannings={filteredPlannings} tasks={tasks} />
            </div>
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="font-bold text-lg mb-4">Yaklaşan Görevler</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {tasks
                    .filter(t => new Date(t.dueDate) >= new Date())
                    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
                    .slice(0, 5)
                    .map(task => (
                      <div key={task._id} className="p-3 bg-gray-50 rounded-lg">
                        <p className="font-semibold text-sm">{task.title}</p>
                        <p className="text-xs text-gray-600">
                          {new Date(task.dueDate).toLocaleDateString('tr-TR')}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Timeline Görünümü
          <TimelineView plannings={filteredPlannings} />
        )}
      </main>
    </div>
  );
};

export default PlanningPage;
