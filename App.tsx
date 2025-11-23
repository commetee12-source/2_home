
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

// --- Facility & Building Definitions ---

const mainBuildingPosition: [number, number, number] = [-15, 2.5, 0];
const mainBuildingSize: [number, number, number] = [10, 5, 20];

// Visual parts inside the main building (not for selection)
const mainBuildingParts: Record<string, { position: [number, number, number]; size: [number, number, number]; color: string }[]> = {
    '본관동 - 교실': [ // More distinct yellow for classrooms
        { position: [-18, 2.4, 6.5], size: [4, 4.8, 6], color: '#F59E0B' }, // amber-500
        { position: [-12, 2.4, 6.5], size: [4, 4.8, 6], color: '#F59E0B' },
        { position: [-18, 2.4, -1.5], size: [4, 4.8, 6], color: '#F59E0B' },
        { position: [-12, 2.4, -1.5], size: [4, 4.8, 6], color: '#F59E0B' },
    ],
    '본관동 - 복도': [{ position: [-15, 2.4, 0], size: [2, 4.8, 20], color: '#D1D5DB' }], // Warmer, more distinct gray for hallway
    '본관동 - 화장실': [ // Kept the same distinct blue
        { position: [-18, 2.4, -8], size: [4, 4.8, 4], color: '#60A5FA' },
        { position: [-12, 2.4, -8], size: [4, 4.8, 4], color: '#60A5FA' },
    ],
};

// Selectable facilities for incident logging and marker placement
const facilities: Facility[] = [
    // Main Building sub-locations (size/color are placeholders, only position matters for markers)
    { name: '본관동 - 교실', position: [-15, 5, 2.5], size: [1,1,1], color: '', type: 'box' },
    { name: '본관동 - 복도', position: [-15, 5, 0], size: [1,1,1], color: '', type: 'box' },
    { name: '본관동 - 화장실', position: [-15, 5, -8], size: [1,1,1], color: '', type: 'box' },
    
    // Other buildings
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

// Main App Component
const App: React.FC = () => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const interactiveObjectsRef = useRef<THREE.Object3D[]>([]);
    const highlightedObjectsRef = useRef<HighlightedObject[]>([]);
    
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [tooltipData, setTooltipData] = useState<TooltipData>({ x: 0, y: 0, visible: false, content: { date: '', cause: '' } });
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [highlightedIncidentId, setHighlightedIncidentId] = useState<number | null>(null);
    
    const incidentMarkersRef = useRef<THREE.Group>(new THREE.Group());
    const mainBuildingIncidentsRef = useRef<THREE.Group>(new THREE.Group());
    
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
            if (obj.type === "Group") return; // Don't try to highlight the group itself
            const mesh = obj as THREE.Mesh;
            if (!mesh.material) return;

            const originalMaterial = mesh.material;
            // Prevent re-highlighting an already highlighted object which corrupts originalMaterial
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

            if (Array.isArray(highlightMaterial)) {
                highlightMaterial.forEach(applyHighlight);
            } else {
                applyHighlight(highlightMaterial);
            }
            mesh.material = highlightMaterial;
        });
    }, [unhighlightAllObjects]);

    const createGymnasium = useCallback(() => {
        const gymGroup = new THREE.Group();
        const facilityData = facilities.find(f => f.name === '체육관')!;
        const [width, height, depth] = facilityData.size;
    
        // Floor
        const floorGeo = new THREE.PlaneGeometry(width, depth);
        const floorMat = new THREE.MeshStandardMaterial({ color: '#D2B48C' }); // tan, wood-like
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        gymGroup.add(floor);
    
        // Court Lines
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        const centerCircleGeo = new THREE.RingGeometry(1.8, 1.85, 32);
        const centerCircle = new THREE.Mesh(centerCircleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        centerCircle.rotation.x = -Math.PI / 2;
        centerCircle.position.y = 0.02; // Slightly above floor
        gymGroup.add(centerCircle);
    
        // Helper to create a basketball hoop
        const createHoop = () => {
            const hoopGroup = new THREE.Group();
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.5, 8), new THREE.MeshStandardMaterial({ color: '#696969' }));
            post.position.y = 1.75;
            const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1 }));
            backboard.position.set(0, 3.05, -0.1);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 16, 32), new THREE.MeshStandardMaterial({ color: '#FF4500' }));
            rim.position.set(0, 2.8, 0.35);
            rim.rotation.x = Math.PI / 2;
            hoopGroup.add(post, backboard, rim);
            return hoopGroup;
        }
    
        const hoop1 = createHoop();
        hoop1.position.z = -(depth / 2 - 1);
        gymGroup.add(hoop1);
    
        const hoop2 = createHoop();
        hoop2.rotation.y = Math.PI;
        hoop2.position.z = depth / 2 - 1;
        gymGroup.add(hoop2);
        
        // Benches
        const createBench = () => {
            const benchGroup = new THREE.Group();
            const benchMat = new THREE.MeshStandardMaterial({color: '#A0522D'}); // sienna
            const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 0.4), benchMat);
            seat.position.y = 0.5;
            const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.4), benchMat);
            leg1.position.set(-1.3, 0.25, 0);
            const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.4), benchMat);
            leg2.position.set(1.3, 0.25, 0);
            benchGroup.add(seat, leg1, leg2);
            return benchGroup;
        }
        
        const bench1 = createBench();
        bench1.position.set(-(width / 2 - 0.5), 0, 0);
        bench1.rotation.y = Math.PI / 2;
        gymGroup.add(bench1);
    
        // Transparent walls
        const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ADD8E6', transparent: true, opacity: 0.15, side: THREE.DoubleSide });
        const wallHeight = height;
        const wall1 = new THREE.Mesh(new THREE.PlaneGeometry(depth, wallHeight), wallMaterial);
        wall1.rotation.y = Math.PI / 2;
        wall1.position.set(-width / 2, wallHeight / 2, 0);
        const wall2 = new THREE.Mesh(new THREE.PlaneGeometry(depth, wallHeight), wallMaterial);
        wall2.rotation.y = -Math.PI / 2;
        wall2.position.set(width / 2, wallHeight / 2, 0);
        const wall3 = new THREE.Mesh(new THREE.PlaneGeometry(width, wallHeight), wallMaterial);
        wall3.position.set(0, wallHeight / 2, -depth / 2);
        gymGroup.add(wall1, wall2, wall3);

        // Add userData and cast shadows for all children
        gymGroup.traverse(child => {
            child.userData.location = '체육관';
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.name = '체육관'; // For highlighting
            }
        });
    
        return gymGroup;
    }, []);
    
    // --- 3D Scene Setup ---
    useEffect(() => {
        if (!mountRef.current) return;

        const currentMount = mountRef.current;

        // Scene, Camera, Renderer
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#334155'); // slate-700
        sceneRef.current = scene;
        
        const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
        camera.position.set(0, 30, 35);

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

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(20, 50, 20);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        
        // Floor
        const floorGeometry = new THREE.PlaneGeometry(100, 100);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: '#475569' }); // slate-600
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Render Main Building Wireframe outline
        const boxGeom = new THREE.BoxGeometry(...mainBuildingSize);
        const edges = new THREE.EdgesGeometry(boxGeom);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
        line.position.set(...mainBuildingPosition);
        line.name = '본관동';
        scene.add(line);
        const mainBuildingLabelDiv = document.createElement('div');
        mainBuildingLabelDiv.className = 'label';
        mainBuildingLabelDiv.textContent = '본관동';
        const mainBuildingLabel = new CSS2DObject(mainBuildingLabelDiv);
        const labelYPos = mainBuildingPosition[1] + mainBuildingSize[1] / 2 + 1;
        mainBuildingLabel.position.set(mainBuildingPosition[0], labelYPos, mainBuildingPosition[2]);
        scene.add(mainBuildingLabel);

        // Other Facilities
        const otherFacilities = facilities.filter(f => !f.name.startsWith('본관동'));
        otherFacilities.forEach(f => {
            let facilityObject: THREE.Object3D;
            
            if (f.name === '체육관') {
                facilityObject = createGymnasium();
                facilityObject.position.set(f.position[0], 0.06, f.position[2]); // Set base position on the floor
            } else {
                let mesh: THREE.Mesh;
                if (f.type === 'box') {
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(...f.size), new THREE.MeshStandardMaterial({ color: f.color }));
                } else { // plane
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

            // Label creation for all facilities
            const labelDiv = document.createElement('div');
            labelDiv.className = 'label';
            labelDiv.textContent = f.name;
            const label = new CSS2DObject(labelDiv);
            const labelY = (f.name === '체육관') 
                ? f.size[1] + 1 // Height of gym + offset
                : (f.type === 'box' ? f.position[1] + f.size[1] / 2 + 1 : f.position[1] + 1);
            label.position.set(f.position[0], labelY, f.position[2]);
            scene.add(label);
        });
        
        scene.add(incidentMarkersRef.current);
        scene.add(mainBuildingIncidentsRef.current);
        
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let hoveredObject: THREE.Object3D | null = null;
        
        const onMouseMove = (event: MouseEvent) => {
            if (selectedIncident) return;
            mouse.x = (event.clientX / currentMount.clientWidth) * 2 - 1;
            mouse.y = -(event.clientY / currentMount.clientHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(interactiveObjectsRef.current, true);

            if (intersects.length > 0) {
                const firstIntersect = intersects[0].object;
                if(hoveredObject !== firstIntersect) {
                    hoveredObject = firstIntersect;
                    if (hoveredObject.userData.incident) {
                         setTooltipData({
                            x: event.clientX,
                            y: event.clientY,
                            visible: true,
                            content: {
                                date: hoveredObject.userData.incident.date,
                                cause: hoveredObject.userData.incident.cause,
                            },
                        });
                    }
                }
                 setTooltipData(prev => ({ ...prev, x: event.clientX, y: event.clientY }));
            } else {
                if(hoveredObject) {
                    hoveredObject = null;
                    setTooltipData(prev => ({ ...prev, visible: false }));
                }
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

    // --- Incident Visualization Management ---
    useEffect(() => {
        incidentMarkersRef.current.clear();
        mainBuildingIncidentsRef.current.clear();
        const newInteractiveObjects: THREE.Object3D[] = [];
        
        const mainBuildingAggregated = incidents.reduce((acc, incident) => {
            if (incident.location.startsWith('본관동')) {
                if (!acc[incident.location]) {
                    acc[incident.location] = { count: 0, latestIncident: incident };
                }
                acc[incident.location].count += incident.count;
                if (new Date(incident.date).getTime() > new Date(acc[incident.location].latestIncident.date).getTime()) {
                     acc[incident.location].latestIncident = incident;
                }
            }
            return acc;
        }, {} as Record<string, { count: number; latestIncident: Incident }>);

        for (const location in mainBuildingAggregated) {
            const data = mainBuildingAggregated[location];
            const parts = mainBuildingParts[location];
            if (!parts) continue;

            parts.forEach(part => {
                const geometry = new THREE.BoxGeometry(...part.size);
                const material = new THREE.MeshStandardMaterial({ color: part.color, opacity: 0.9, transparent: true });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(...part.position);
                mesh.castShadow = true;
                mesh.userData.location = location;
                mainBuildingIncidentsRef.current.add(mesh);
            });
            
            const facility = facilities.find(f => f.name === location);
            if(facility) {
                const labelDiv = document.createElement('div');
                const isHighlighted = data.latestIncident.id === highlightedIncidentId;
                labelDiv.className = isHighlighted ? 'marker highlighted-marker' : 'marker';
                const shortName = location.split(' - ')[1];
                labelDiv.innerHTML = `<span class="text-xs">${shortName}</span>: ${data.count}`;
                labelDiv.style.width = 'auto';
                labelDiv.style.height = 'auto';
                labelDiv.style.padding = '4px 8px';
                labelDiv.style.borderRadius = '8px';
                
                const label = new CSS2DObject(labelDiv);
                const labelY = mainBuildingPosition[1] + mainBuildingSize[1] / 2 + 3;
                label.position.set(facility.position[0], labelY, facility.position[2]);
                label.userData = { incident: data.latestIncident };
                label.element.style.pointerEvents = 'auto';
                label.element.addEventListener('click', () => handleIncidentSelect(data.latestIncident));

                mainBuildingIncidentsRef.current.add(label);
                newInteractiveObjects.push(label);
            }
        }

        incidents.forEach(incident => {
            if (incident.location.startsWith('본관동')) return;

            const facility = facilities.find(f => f.name === incident.location);
            if (!facility) return;

            const markerDiv = document.createElement('div');
            const isHighlighted = incident.id === highlightedIncidentId;
            markerDiv.className = isHighlighted ? 'marker highlighted-marker' : 'marker';
            markerDiv.textContent = incident.count.toString();
            
            const marker = new CSS2DObject(markerDiv);
            
            const markerY = facility.name === '체육관' 
                ? facility.size[1] + 2 
                : (facility.type === 'box' ? facility.position[1] + facility.size[1] / 2 + 3 : facility.position[1] + 3);

            marker.position.set(facility.position[0], markerY, facility.position[2]);
            marker.userData = { incident };
            marker.element.style.pointerEvents = 'auto';
            marker.element.addEventListener('click', () => handleIncidentSelect(incident));
            
            incidentMarkersRef.current.add(marker);
            newInteractiveObjects.push(marker);
        });

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
        setIncidents(prev => [...prev, newIncident]);
        e.currentTarget.reset();
    }, []);

    const handleCloseModal = () => {
        setSelectedIncident(null);
        setHighlightedIncidentId(null);
        unhighlightAllObjects();
    };

    const sortedIncidents = useMemo(() => {
        return [...incidents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [incidents]);

    return (
        <div id="app-container" className="relative w-screen h-screen bg-gray-800">
            <div ref={mountRef} className="w-full h-full" />

            {/* Registration Form */}
            <div className="absolute top-4 left-4 p-6 bg-slate-800/70 backdrop-blur-sm rounded-lg shadow-2xl text-white max-w-sm w-full">
                <h1 className="text-2xl font-bold mb-4 border-b-2 border-blue-400 pb-2">사고 등록</h1>
                <form onSubmit={handleAddIncident} className="space-y-4">
                    <div>
                        <label htmlFor="date" className="block text-sm font-medium text-gray-300 mb-1">발생일시</label>
                        <input type="date" id="date" name="date" required 
                               className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                        <label htmlFor="location" className="block text-sm font-medium text-gray-300 mb-1">발생장소</label>
                        <select id="location" name="location" required
                                className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            {facilityLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="count" className="block text-sm font-medium text-gray-300 mb-1">발생건수</label>
                        <input type="number" id="count" name="count" min="1" defaultValue="1" required
                               className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                        <label htmlFor="cause" className="block text-sm font-medium text-gray-300 mb-1">발생원인</label>
                        <input type="text" id="cause" name="cause" required maxLength={50}
                               className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 ease-in-out transform hover:scale-105">
                        등록
                    </button>
                </form>
            </div>
            
            {/* Incident List */}
            <div className="absolute top-4 right-4 p-6 bg-slate-800/70 backdrop-blur-sm rounded-lg shadow-2xl text-white max-w-sm w-full max-h-[calc(100vh-2rem)] flex flex-col">
                 <h1 className="text-2xl font-bold mb-4 border-b-2 border-green-400 pb-2 flex-shrink-0">사고 목록</h1>
                 <div className="space-y-3 overflow-y-auto incident-list pr-2">
                    {sortedIncidents.length === 0 && <p className="text-gray-400 text-center py-4">등록된 사고가 없습니다.</p>}
                    {sortedIncidents.map(incident => (
                        <div key={incident.id} onClick={() => handleIncidentSelect(incident)}
                             className={`p-3 bg-slate-700/50 hover:bg-slate-600/70 rounded-md cursor-pointer transition-all duration-200 border-l-4  hover:border-green-400 ${highlightedIncidentId === incident.id ? 'bg-slate-600/90 border-amber-400' : 'border-slate-500'}`}>
                             <div className="flex justify-between items-start">
                                <div className="text-sm">
                                    <p className="font-semibold text-green-300">{incident.location}</p>
                                    <p className="text-xs text-gray-300">{new Date(incident.date).toLocaleDateString()}</p>
                                    <p className="text-xs text-gray-400 mt-1">원인: {truncate(incident.cause, 25)}</p>
                                </div>
                                <div className="flex-shrink-0 ml-4 text-lg font-bold bg-red-500 rounded-full w-8 h-8 flex items-center justify-center text-white">
                                    {incident.count}
                                </div>
                             </div>
                        </div>
                    ))}
                 </div>
            </div>

            {/* Incident Detail Modal */}
            {selectedIncident && (
                <div className="absolute inset-0 bg-black/60 flex justify-center items-center z-50 backdrop-blur-sm" onClick={handleCloseModal}>
                    <div className="bg-slate-800 text-white p-8 rounded-lg shadow-2xl max-w-lg w-full m-4" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-2xl font-bold mb-4 text-amber-300 border-b-2 border-amber-400 pb-2">사고 상세 정보</h2>
                        <div className="space-y-3 text-lg">
                            <p><strong className="font-semibold text-gray-300 w-24 inline-block">발생일시:</strong> {new Date(selectedIncident.date).toLocaleDateString()}</p>
                            <p><strong className="font-semibold text-gray-300 w-24 inline-block">발생장소:</strong> {selectedIncident.location}</p>
                            <p><strong className="font-semibold text-gray-300 w-24 inline-block">발생건수:</strong> {selectedIncident.count}</p>
                            <div>
                                <p><strong className="font-semibold text-gray-300 w-24 inline-block align-top">발생원인:</strong></p>
                                <p className="bg-slate-700 p-3 rounded-md mt-1 text-base">{selectedIncident.cause}</p>
                            </div>
                        </div>
                        <button onClick={handleCloseModal} className="mt-6 w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2 px-4 rounded-md transition duration-300">
                            닫기
                        </button>
                    </div>
                </div>
            )}

            <Tooltip data={tooltipData} />
        </div>
    );
};

export default App;
