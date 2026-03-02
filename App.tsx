
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Define types
interface Facility {
    name: string;
    position: [number, number, number];
    size: [number, number, number];
    color: string;
    type: 'box' | 'plane';
}

interface Incident {
    id: number;
    date: string;
    location: string;
    count: number;
    cause: string;
}

interface TooltipData {
    x: number;
    y: number;
    visible: boolean;
    content: {
        date: string;
        cause: string;
    };
}

interface HighlightedObject {
    object: THREE.Object3D;
    originalMaterial: THREE.Material | THREE.Material[];
}

const STORAGE_KEY = 'school_safety_incidents_v1';

// --- Facility & Building Definitions ---
const mainBuildingPosition: [number, number, number] = [-15, 2.5, 0];
const mainBuildingSize: [number, number, number] = [10, 5, 20];

const mainBuildingParts: Record<string, { position: [number, number, number]; size: [number, number, number]; color: string }[]> = {
    '본관동 - 교실': [
        { position: [-18, 2.4, 6.5], size: [4, 4.8, 6], color: '#F59E0B' },
        { position: [-12, 2.4, 6.5], size: [4, 4.8, 6], color: '#F59E0B' },
        { position: [-18, 2.4, -1.5], size: [4, 4.8, 6], color: '#F59E0B' },
        { position: [-12, 2.4, -1.5], size: [4, 4.8, 6], color: '#F59E0B' },
    ],
    '본관동 - 복도': [{ position: [-15, 2.4, 0], size: [2, 4.8, 20], color: '#D1D5DB' }],
    '본관동 - 화장실': [
        { position: [-18, 2.4, -8], size: [4, 4.8, 4], color: '#60A5FA' },
        { position: [-12, 2.4, -8], size: [4, 4.8, 4], color: '#60A5FA' },
    ],
};

const facilities: Facility[] = [
    { name: '본관동 - 교실', position: [-15, 5, 2.5], size: [1,1,1], color: '', type: 'box' },
    { name: '본관동 - 복도', position: [-15, 5, 0], size: [1,1,1], color: '', type: 'box' },
    { name: '본관동 - 화장실', position: [-15, 5, -8], size: [1,1,1], color: '', type: 'box' },
    { name: '체육관', position: [15, 4, 10], size: [15, 8, 12], color: '#0000FF', type: 'box' },
    { name: '정보화동', position: [15, 2, -10], size: [10, 4, 8], color: '#008000', type: 'box' },
    { name: '운동장', position: [0, 0.05, 0], size: [20, 30, 0], color: '#A0522D', type: 'plane' },
    { name: '급식실', position: [-5, 1.5, 15], size: [8, 3, 6], color: '#FFA500', type: 'box' },
    { name: '학생식당', position: [-5, 1.5, 22], size: [8, 3, 8], color: '#2DD4BF', type: 'box' },
    { name: '창고', position: [20, 1, 0], size: [4, 2, 4], color: '#A9A9A9', type: 'box' },
];

const facilityLocations = facilities.map(f => f.name);

const truncate = (str: string, n: number) => {
    return (str.length > n) ? str.slice(0, n - 1) + '...' : str;
};

// Tooltip Component
const Tooltip: React.FC<{ data: TooltipData }> = ({ data }) => {
    if (!data.visible) return null;
    return (
        <div
            className="fixed p-3 rounded-lg shadow-xl bg-gray-800/90 text-white text-sm pointer-events-none transition-opacity duration-200"
            style={{ left: `${data.x + 15}px`, top: `${data.y + 15}px`, opacity: data.visible ? 1 : 0, zIndex: 100 }}
        >
            <p><strong className="font-semibold text-blue-300">발생일시:</strong> {new Date(data.content.date).toLocaleDateString()}</p>
            <p><strong className="font-semibold text-blue-300">발생원인:</strong> {data.content.cause}</p>
        </div>
    );
};

const App: React.FC = () => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const interactiveObjectsRef = useRef<THREE.Object3D[]>([]);
    const highlightedObjectsRef = useRef<HighlightedObject[]>([]);
    
    // Initialize incidents from localStorage
    const [incidents, setIncidents] = useState<Incident[]>(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    });
    
    const [tooltipData, setTooltipData] = useState<TooltipData>({ x: 0, y: 0, visible: false, content: { date: '', cause: '' } });
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [highlightedIncidentId, setHighlightedIncidentId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const locationIncidents = useMemo(() => {
        if (!selectedIncident) return [];
        return incidents.filter(inc => inc.location === selectedIncident.location);
    }, [incidents, selectedIncident]);
    
    const markersGroupRef = useRef<THREE.Group>(new THREE.Group());
    const buildingMeshesRef = useRef<THREE.Group>(new THREE.Group());

    // Save incidents to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
    }, [incidents]);
    
    // --- Highlighting Logic ---
    const unhighlightAllObjects = useCallback(() => {
        highlightedObjectsRef.current.forEach(({ object, originalMaterial }) => {
            (object as THREE.Mesh).material = originalMaterial;
        });
        highlightedObjectsRef.current = [];
    }, []);

    const highlightObjectsByLocation = useCallback((locationName: string) => {
        unhighlightAllObjects();
        const scene = sceneRef.current;
        if (!scene) return;

        const objectsToHighlight: THREE.Object3D[] = [];
        scene.traverse((object) => {
            if ((object.name === locationName || object.userData.location === locationName)) {
                objectsToHighlight.push(object);
            }
        });

        if (locationName.startsWith('본관동')) {
            const mainBuildingFrame = scene.getObjectByName('본관동');
            if (mainBuildingFrame) objectsToHighlight.push(mainBuildingFrame);
        }

        objectsToHighlight.forEach(obj => {
            if (obj.type === "Group") return;
            const mesh = obj as THREE.Mesh;
            if (!mesh.material) return;
            const originalMaterial = mesh.material;
            if (highlightedObjectsRef.current.some(h => h.object === mesh)) return;

            const highlightMaterial = Array.isArray(originalMaterial) 
                ? originalMaterial.map(m => m.clone()) 
                : originalMaterial.clone();
            
            highlightedObjectsRef.current.push({ object: mesh, originalMaterial });

            const applyHighlight = (mat: THREE.Material) => {
                if (mat instanceof THREE.MeshStandardMaterial) {
                    mat.emissive.set('#facc15');
                    mat.emissiveIntensity = 0.6;
                } else if (mat instanceof THREE.LineBasicMaterial) {
                    mat.color.set('#fde047');
                }
            };

            if (Array.isArray(highlightMaterial)) highlightMaterial.forEach(applyHighlight);
            else applyHighlight(highlightMaterial);
            mesh.material = highlightMaterial;
        });
    }, [unhighlightAllObjects]);

    const createGymnasium = useCallback(() => {
        const gymGroup = new THREE.Group();
        const facilityData = facilities.find(f => f.name === '체육관')!;
        const [width, height, depth] = facilityData.size;
    
        const floorGeo = new THREE.PlaneGeometry(width, depth);
        const floorMat = new THREE.MeshStandardMaterial({ color: '#D2B48C' });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        gymGroup.add(floor);
    
        const centerCircleGeo = new THREE.RingGeometry(1.8, 1.85, 32);
        const centerCircle = new THREE.Mesh(centerCircleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        centerCircle.rotation.x = -Math.PI / 2;
        centerCircle.position.y = 0.02;
        gymGroup.add(centerCircle);
    
        const createHoop = () => {
            const hoopGroup = new THREE.Group();
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.5, 8), new THREE.MeshStandardMaterial({ color: '#696969' }));
            post.position.y = 1.75;
            const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
            backboard.position.set(0, 3.05, -0.1);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 16, 32), new THREE.MeshStandardMaterial({ color: '#FF4500' }));
            rim.position.set(0, 2.8, 0.35);
            rim.rotation.x = Math.PI / 2;
            hoopGroup.add(post, backboard, rim);
            return hoopGroup;
        }
        const hoop1 = createHoop(); hoop1.position.z = -(depth / 2 - 1); gymGroup.add(hoop1);
        const hoop2 = createHoop(); hoop2.rotation.y = Math.PI; hoop2.position.z = depth / 2 - 1; gymGroup.add(hoop2);
        
        const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ADD8E6', transparent: true, opacity: 0.15, side: THREE.DoubleSide });
        const wall1 = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wallMaterial);
        wall1.rotation.y = Math.PI / 2;
        wall1.position.set(-width / 2, height / 2, 0);
        const wall2 = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wallMaterial);
        wall2.rotation.y = -Math.PI / 2;
        wall2.position.set(width / 2, height / 2, 0);
        const wall3 = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMaterial);
        wall3.position.set(0, height / 2, -depth / 2);
        gymGroup.add(wall1, wall2, wall3);

        gymGroup.traverse(child => {
            child.userData.location = '체육관';
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.name = '체육관';
            }
        });
        return gymGroup;
    }, []);
    
    // --- 3D Scene Setup ---
    useEffect(() => {
        if (!mountRef.current) return;
        const currentMount = mountRef.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#334155');
        sceneRef.current = scene;
        
        const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
        camera.position.set(0, 30, 45);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        renderer.shadowMap.enabled = true;
        currentMount.appendChild(renderer.domElement);
        
        const labelRenderer = new CSS2DRenderer();
        labelRenderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        labelRenderer.domElement.style.position = 'absolute';
        labelRenderer.domElement.style.top = '0px';
        labelRenderer.domElement.style.pointerEvents = 'none';
        currentMount.appendChild(labelRenderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(20, 50, 20);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#475569' }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const boxGeom = new THREE.BoxGeometry(...mainBuildingSize);
        const line = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeom), new THREE.LineBasicMaterial({ color: 0xffffff }));
        line.position.set(...mainBuildingPosition);
        line.name = '본관동';
        scene.add(line);

        facilities.filter(f => !f.name.startsWith('본관동')).forEach(f => {
            let facilityObject: THREE.Object3D;
            if (f.name === '체육관') {
                facilityObject = createGymnasium();
                facilityObject.position.set(f.position[0], 0.06, f.position[2]);
            } else {
                let mesh: THREE.Mesh;
                if (f.type === 'box') {
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(...f.size), new THREE.MeshStandardMaterial({ color: f.color }));
                } else {
                    mesh = new THREE.Mesh(new THREE.PlaneGeometry(f.size[0], f.size[1]), new THREE.MeshStandardMaterial({ color: f.color, side: THREE.DoubleSide }));
                    mesh.rotation.x = -Math.PI / 2;
                }
                mesh.position.set(...f.position);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                facilityObject = mesh;
            }
            facilityObject.name = f.name;
            scene.add(facilityObject);
        });
        
        scene.add(markersGroupRef.current);
        scene.add(buildingMeshesRef.current);
        
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        
        const onMouseMove = (event: MouseEvent) => {
            if (selectedIncident) return;
            mouse.x = (event.clientX / currentMount.clientWidth) * 2 - 1;
            mouse.y = -(event.clientY / currentMount.clientHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(interactiveObjectsRef.current, true);

            if (intersects.length > 0) {
                const firstIntersect = intersects[0].object;
                if (firstIntersect.userData.incident) {
                    setTooltipData({
                        x: event.clientX, y: event.clientY, visible: true,
                        content: { date: firstIntersect.userData.incident.date, cause: firstIntersect.userData.incident.cause }
                    });
                }
            } else {
                setTooltipData(prev => ({ ...prev, visible: false }));
            }
        };
        currentMount.addEventListener('mousemove', onMouseMove);

        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
            labelRenderer.render(scene, camera);
        };
        animate();

        const handleResize = () => {
            camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
            labelRenderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            currentMount.removeEventListener('mousemove', onMouseMove);
            currentMount.removeChild(renderer.domElement);
            currentMount.removeChild(labelRenderer.domElement);
            sceneRef.current = null;
        };
    }, [selectedIncident, createGymnasium]);
    
    const handleIncidentSelect = useCallback((incident: Incident) => {
        setSelectedIncident(incident);
        setHighlightedIncidentId(incident.id);
        highlightObjectsByLocation(incident.location);
        setTooltipData(prev => ({ ...prev, visible: false }));
    }, [highlightObjectsByLocation]);

    // --- Aggregated Visualization Logic ---
    useEffect(() => {
        markersGroupRef.current.clear();
        buildingMeshesRef.current.clear();
        const newInteractiveObjects: THREE.Object3D[] = [];
        
        // Aggregate all incidents by location
        const aggregatedData = incidents.reduce((acc, incident) => {
            if (!acc[incident.location]) {
                acc[incident.location] = { count: 0, latestIncident: incident };
            }
            acc[incident.location].count += incident.count;
            if (new Date(incident.date).getTime() >= new Date(acc[incident.location].latestIncident.date).getTime()) {
                acc[incident.location].latestIncident = incident;
            }
            return acc;
        }, {} as Record<string, { count: number; latestIncident: Incident }>);

        // Render main building part colors
        for (const location in mainBuildingParts) {
            if (aggregatedData[location]) {
                mainBuildingParts[location].forEach(part => {
                    const mesh = new THREE.Mesh(
                        new THREE.BoxGeometry(...part.size),
                        new THREE.MeshStandardMaterial({ color: part.color, opacity: 0.9, transparent: true })
                    );
                    mesh.position.set(...part.position);
                    mesh.userData.location = location;
                    buildingMeshesRef.current.add(mesh);
                });
            }
        }

        // Create Markers for every location that has incidents
        for (const locName in aggregatedData) {
            const data = aggregatedData[locName];
            const facility = facilities.find(f => f.name === locName);
            if (!facility) continue;

            const isHighlighted = data.latestIncident.id === highlightedIncidentId;
            const markerDiv = document.createElement('div');
            markerDiv.className = isHighlighted ? 'marker highlighted-marker' : 'marker';
            
            // Format label content
            const displayName = locName.includes(' - ') ? locName.split(' - ')[1] : locName;
            markerDiv.innerHTML = `<div class="flex flex-col items-center"><span class="text-[10px] leading-tight opacity-80">${displayName}</span><span class="font-bold">${data.count}</span></div>`;
            markerDiv.style.padding = '5px';
            markerDiv.style.minWidth = '45px';
            markerDiv.style.height = '45px';
            
            const marker = new CSS2DObject(markerDiv);
            const yOffset = (facility.name === '체육관' ? facility.size[1] + 2 : (facility.type === 'box' ? facility.position[1] + facility.size[1]/2 + 3 : 3));
            marker.position.set(facility.position[0], yOffset, facility.position[2]);
            marker.userData = { incident: data.latestIncident };
            marker.element.style.pointerEvents = 'auto';
            marker.element.addEventListener('click', () => handleIncidentSelect(data.latestIncident));

            markersGroupRef.current.add(marker);
            newInteractiveObjects.push(marker);
        }

        interactiveObjectsRef.current = newInteractiveObjects;
    }, [incidents, highlightedIncidentId, handleIncidentSelect]);

    const handleAddIncident = useCallback((e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const newIncident: Incident = {
            id: Date.now(),
            date: formData.get('date') as string,
            location: formData.get('location') as string,
            count: parseInt(formData.get('count') as string, 10),
            cause: formData.get('cause') as string,
        };
        setIncidents(prev => [newIncident, ...prev]);
        e.currentTarget.reset();
    }, []);

    const clearAllData = () => {
        if (confirm('모든 사고 데이터를 초기화하시겠습니까?')) {
            setIncidents([]);
            localStorage.removeItem(STORAGE_KEY);
        }
    };

    const downloadIncidents = () => {
        if (incidents.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const headers = ['발생일시', '발생장소', '발생건수', '발생원인'];
        const csvContent = [
            headers.join(','),
            ...incidents.map(inc => [
                inc.date,
                `"${inc.location}"`,
                inc.count,
                `"${inc.cause.replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `school_safety_incidents_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const uploadIncidents = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (!content) return;

            const cleanContent = content.replace(/^\uFEFF/, '');
            const lines = cleanContent.split(/\r?\n/);
            if (lines.length < 2) return;

            const newIncidents: Incident[] = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts: string[] = [];
                let current = '';
                let inQuotes = false;
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        if (inQuotes && line[j+1] === '"') {
                            current += '"';
                            j++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (char === ',' && !inQuotes) {
                        parts.push(current);
                        current = '';
                    } else {
                        current += char;
                    }
                }
                parts.push(current);

                if (parts.length >= 4) {
                    const [date, location, count, cause] = parts;
                    const cleanLocation = location.trim();
                    if (facilityLocations.includes(cleanLocation)) {
                        newIncidents.push({
                            id: Date.now() + i,
                            date: date.trim(),
                            location: cleanLocation,
                            count: parseInt(count, 10) || 1,
                            cause: cause.trim()
                        });
                    }
                }
            }

            if (newIncidents.length > 0) {
                setIncidents(prev => [...newIncidents, ...prev]);
                alert(`${newIncidents.length}건의 사고 기록이 업로드되었습니다.`);
            } else {
                alert('유효한 사고 기록을 찾을 수 없습니다. 파일 형식을 확인해주세요.');
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    };

    const handleCloseModal = () => {
        setSelectedIncident(null);
        setHighlightedIncidentId(null);
        unhighlightAllObjects();
    };

    const deleteIncident = (id: number) => {
        if (confirm('이 사고 기록을 삭제하시겠습니까?')) {
            setIncidents(prev => prev.filter(inc => inc.id !== id));
            if (selectedIncident?.id === id) {
                handleCloseModal();
            }
        }
    };

    const filteredIncidents = useMemo(() => {
        return incidents.filter(inc => 
            inc.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
            inc.cause.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [incidents, searchQuery]);

    const stats = useMemo(() => {
        return {
            totalIncidents: incidents.length,
            totalCount: incidents.reduce((sum, inc) => sum + inc.count, 0)
        };
    }, [incidents]);

    return (
        <div id="app-container" className="relative w-screen h-screen bg-gray-900">
            <div ref={mountRef} className="w-full h-full" />

            {/* Registration Form */}
            <div className="absolute top-4 left-4 p-5 bg-slate-800/80 backdrop-blur-md rounded-xl shadow-2xl text-white max-w-[320px] w-full border border-slate-700">
                <h1 className="text-xl font-bold mb-4 border-b border-blue-500/50 pb-2 flex items-center">
                    <span className="mr-2 text-blue-400">🚨</span> 사고 등록
                </h1>
                <form onSubmit={handleAddIncident} className="space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1">발생일시</label>
                        <input type="date" name="date" required className="w-full p-2 bg-slate-700 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1">발생장소</label>
                        <select name="location" required className="w-full p-2 bg-slate-700 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none">
                            {facilityLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1">발생건수</label>
                        <input type="number" name="count" min="1" defaultValue="1" required className="w-full p-2 bg-slate-700 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1">발생원인</label>
                        <textarea name="cause" required maxLength={100} rows={2} className="w-full p-2 bg-slate-700 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-none" placeholder="간략히 입력..." />
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition-all transform active:scale-95 shadow-lg">
                        등록하기
                    </button>
                </form>
            </div>
            
            {/* Incident List */}
            <div className="absolute top-4 right-4 p-5 bg-slate-800/80 backdrop-blur-md rounded-xl shadow-2xl text-white max-w-[340px] w-full max-h-[calc(100vh-2rem)] flex flex-col border border-slate-700">
                 <div className="flex justify-between items-center mb-4 border-b border-green-500/50 pb-2">
                    <h1 className="text-xl font-bold flex items-center">
                        <span className="mr-2 text-green-400">📋</span> 사고 목록
                    </h1>
                    <div className="flex gap-2">
                        <label className="cursor-pointer text-[10px] bg-indigo-900/50 hover:bg-indigo-800 px-2 py-1 rounded text-indigo-200 transition-colors">
                            업로드
                            <input type="file" accept=".csv" onChange={uploadIncidents} className="hidden" />
                        </label>
                        <button onClick={downloadIncidents} className="text-[10px] bg-blue-900/50 hover:bg-blue-800 px-2 py-1 rounded text-blue-200 transition-colors">다운로드</button>
                        <button onClick={clearAllData} className="text-[10px] bg-red-900/50 hover:bg-red-800 px-2 py-1 rounded text-red-200 transition-colors">전체 초기화</button>
                    </div>
                 </div>

                 {/* Stats Summary */}
                 <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-700/50 text-center">
                        <p className="text-[9px] text-gray-500 uppercase tracking-tighter">총 사고 건수</p>
                        <p className="text-lg font-black text-blue-400">{stats.totalIncidents}</p>
                    </div>
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-700/50 text-center">
                        <p className="text-[9px] text-gray-500 uppercase tracking-tighter">총 피해 수량</p>
                        <p className="text-lg font-black text-red-400">{stats.totalCount}</p>
                    </div>
                 </div>

                 {/* Search Bar */}
                 <div className="mb-4 relative">
                    <input 
                        type="text" 
                        placeholder="장소 또는 원인 검색..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg py-2 pl-8 pr-3 text-xs focus:ring-1 focus:ring-green-500 outline-none"
                    />
                    <span className="absolute left-2.5 top-2.5 text-gray-500">🔍</span>
                 </div>

                 <div className="space-y-2 overflow-y-auto incident-list pr-1 flex-1">
                    {filteredIncidents.length === 0 && (
                        <p className="text-gray-500 text-center py-10 italic text-sm">
                            {searchQuery ? '검색 결과가 없습니다.' : '등록된 데이터가 없습니다.'}
                        </p>
                    )}
                    {filteredIncidents.map(incident => (
                        <div key={incident.id} onClick={() => handleIncidentSelect(incident)}
                             className={`p-3 bg-slate-700/40 hover:bg-slate-700/80 rounded-lg cursor-pointer transition-all border-l-4 ${highlightedIncidentId === incident.id ? 'border-amber-400 bg-slate-700/90' : 'border-slate-500'}`}>
                             <div className="flex justify-between items-start">
                                <div className="text-sm flex-1 min-w-0">
                                    <p className="font-bold text-blue-300 truncate">{incident.location}</p>
                                    <p className="text-[11px] text-gray-400">{new Date(incident.date).toLocaleDateString()}</p>
                                    <p className="text-[12px] text-gray-200 mt-1 line-clamp-1">{incident.cause}</p>
                                </div>
                                <div className="ml-2 flex flex-col items-end gap-2">
                                    <div className="font-black text-xs bg-red-600 px-2 py-1 rounded-full text-white min-w-[24px] text-center shadow-sm">
                                        {incident.count}
                                    </div>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); deleteIncident(incident.id); }}
                                        className="text-[10px] text-gray-500 hover:text-red-400 transition-colors p-1"
                                        title="삭제"
                                    >
                                        삭제
                                    </button>
                                </div>
                             </div>
                        </div>
                    ))}
                 </div>
            </div>

            {/* Incident Detail Modal */}
            {selectedIncident && (
                <div className="absolute inset-0 bg-black/70 flex justify-center items-center z-50 backdrop-blur-sm" onClick={handleCloseModal}>
                    <div className="bg-slate-800 border border-slate-700 text-white p-7 rounded-2xl shadow-2xl max-w-2xl w-full m-4 transform animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-2">
                            <div>
                                <h2 className="text-xl font-bold text-amber-400">사고 이력 리포트</h2>
                                <p className="text-sm text-gray-400 font-semibold">{selectedIncident.location}</p>
                            </div>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-white text-2xl">✕</button>
                        </div>
                        
                        <div className="overflow-y-auto pr-2 space-y-4 flex-1 incident-list">
                            {locationIncidents.map((inc, index) => (
                                <div key={inc.id} className="bg-slate-900/50 p-5 rounded-xl border border-slate-700/50 relative">
                                    <div className="absolute top-4 right-4 bg-red-600/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-400/30">
                                        사건 #{locationIncidents.length - index}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                                        <div>
                                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-1">발생 날짜</span>
                                            <span className="text-white font-medium">{new Date(inc.date).toLocaleDateString()}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-1">피해 건수</span>
                                            <span className="text-red-400 font-bold">{inc.count}건</span>
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-1">발생 원인 및 상세 내용</span>
                                        <p className="text-gray-200 leading-relaxed italic text-sm">
                                            "{inc.cause}"
                                        </p>
                                    </div>
                                    <div className="mt-3 flex justify-end">
                                        <button 
                                            onClick={() => deleteIncident(inc.id)}
                                            className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                                        >
                                            이 기록 삭제
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button onClick={handleCloseModal} className="mt-6 w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 rounded-xl transition-all shadow-lg active:scale-[0.98] shrink-0">
                            확인 및 닫기
                        </button>
                    </div>
                </div>
            )}

            <Tooltip data={tooltipData} />
            <div className="absolute bottom-4 left-4 text-white/30 text-[10px] pointer-events-none">
                Data persists in your browser's local storage.
            </div>
        </div>
    );
};

export default App;
