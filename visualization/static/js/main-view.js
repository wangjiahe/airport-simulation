"use strict";

const getModeAndPlan = () => {
    let params = [], hash;
    let hashes = window.location.href
        .slice(window.location.href.indexOf("?") + 1)
        .split("&");
    for (let i = 0; i < hashes.length; i++) {
        hash = hashes[i].split("=");
        params.push(hash[0]);
        params[hash[0]] = hash[1];
    }

    const mode = ("mode" in params) ? params["mode"] : null;
    const plan = ("plan" in params) ? params["plan"] : null;

    return [mode, plan];
};

function startVisualization() {
    new VisualizationView(getModeAndPlan());
}

const AUTO_RUN_INTERVAL = 550;
const FAST_FORWARD_STEP_SIZE = 120;

class VisualizationView {
    constructor(modeAndPlan) {
        this.mapView = new MapView(document.getElementById("map"));
        this.mode = modeAndPlan[0];
        this.plan = modeAndPlan[1];

        this.autoRunWorker = null;

        this.initComponents();
        this.initDataSource();
    }

    initDataSource() {
        if (this.mode && this.plan) {
            this.initDataConnector();
            return;
        }

        UIkit.modal("#data-source-modal").show();

        StreamingDataConnector.loadPlans().then(plans => {
            for (let p of plans) {
                const node = document.createElement("li");
                node.innerHTML = `<a>${p}</a>`;
                node.addEventListener("click", e => {
                    $("#streaming-run").text(`Run ${p}`).prop("disabled", false);

                    this.mode = "streaming";
                    this.plan = p;
                });

                $("#streaming-plans-dropdown").append(node);
            }
        });

        BatchDataConnector.loadPlans().then(plans => {
            for (let p of plans) {
                const node = document.createElement("li");
                node.innerHTML = `<a>${p}</a>`;
                node.addEventListener("click", e => {
                    $("#batch-run").text(`Run ${p}`).prop("disabled", false);

                    this.mode = "batch";
                    this.plan = p;
                });

                $("#batch-plans-dropdown").append(node);
            }
        });

        $("#streaming-run").on("click", e => {
            UIkit.modal("#data-source-modal").hide();
            window.location.href = `?mode=streaming&plan=${this.plan}`;
        });

        $("#batch-run").on("click", e => {
            UIkit.modal("#data-source-modal").hide();
            window.location.href = `?mode=batch&plan=${this.plan}`;
        });
    }

    initDataConnector() {
        UIkit.modal("#data-loading-modal").show();

        this.dataConnector = (this.mode === "batch") ?
            new BatchDataConnector(this.plan, this.initSurfaceData.bind(this)) :
            new StreamingDataConnector(this.plan, this.initSurfaceData.bind(this));
    }

    initSurfaceData() {
        UIkit.modal("#data-loading-modal").hide();

        // Set airport as the map center
        const surfaceData = this.dataConnector.getSurfaceData();
        const center = surfaceData["airport_center"];
        this.mapView.init(center["lat"], center["lng"]);
        $("#plan-name").text(surfaceData["airport_name"]);

        // Gate
        for (let gate of surfaceData["gates"]) {
            const name = "GATE: " + gate["name"];
            this.mapView.drawGate(gate["lat"], gate["lng"], name);
        }

        // Runway
        for (let runway of surfaceData["runways"]) {
            this.mapView.drawRunway(parseNodes(runway["nodes"]));
        }

        // Pushback way
        for (let pushback_way of surfaceData["pushback_ways"]) {
            this.mapView.drawPushbackWay(parseNodes(pushback_way["nodes"]));
        }

        // Taxiway
        for (let taxiway of surfaceData["taxiways"]) {
            this.mapView.drawTaxiway(parseNodes(taxiway["nodes"]));
        }

        // Spots
        for (let spot of surfaceData["spots"]) {
            const name = "SPOT: " + spot["name"];
            this.mapView.drawSpot(spot["lat"], spot["lng"], name);
        }

        // Intersections
        for (let inter of surfaceData["inters"]) {
            const name = "INTERSECTION: " + inter["name"];
            this.mapView.drawIntersection(inter["lat"], inter["lng"], name);
        }

        const initState = this.dataConnector.currentState();
        this.handleStateUpdate(initState);
    }

    initComponents() {
        // Control Box
        $("#plan-mode").text(this.mode);

        $("#control-run").click(e => {
            e.preventDefault();
            this.toggleAutoRun();
            return false;
        });

        $("#control-prev").click(async e => {
            e.preventDefault();
            const state = await this.dataConnector.prevState();
            this.handleStateUpdate(state, false);
            return false;
        });

        $("#control-next").click(async e => {
            e.preventDefault();
            const state = await this.dataConnector.nextState();
            this.handleStateUpdate(state);
            return false;
        });

        $("#control-back").click(async e => {
            e.preventDefault();
            const state = await this.dataConnector.prevState(FAST_FORWARD_STEP_SIZE);
            this.handleStateUpdate(state, false);
            return false;
        });

        $("#control-forward").click(async e => {
            e.preventDefault();
            const state = await this.dataConnector.nextState(FAST_FORWARD_STEP_SIZE);
            this.handleStateUpdate(state, false);
            return false;
        });
    }

    handleStateUpdate(state, use_animation = true) {
        $("#current-time").text(state["time"]);

        const stateToDisplay = aircraft => {
            if (aircraft["takeoff"]) {
                return "TakingOff";
            } else if (aircraft["state"] === "stop") {
                return "Stopped";
            } else if (aircraft["is_delayed"]) {
                return "Hold";
            } else {
                return "Moving";
            }
        };

        let allAircraft = [];
        for (let aircraft of state["aircrafts"]) {
            allAircraft.push({
                lat: aircraft["location"]["lat"],
                lng: aircraft["location"]["lng"],
                status: stateToDisplay(aircraft),
                name: aircraft["callsign"],
                speed: aircraft["speed"],
                pushback_speed: aircraft["pushback_speed"]
            });
        }

        this.mapView.updateAllAircraft(allAircraft, use_animation);

        // Update traffic table
        let trafficTableHtml = "";
        let holdCount = 0, allCount = 0;
        for (let aircraft of state["aircrafts"]) {
            let statusLabel;

            if (aircraft["state"] === "stop") {
                statusLabel = `<span class="uk-label uk-label-success">Taking Off</span>`;
            } else if (aircraft["is_delayed"]) {
                statusLabel = `<span class="uk-label uk-label-danger">Hold</span>`;
                holdCount += 1;
            } else {
                statusLabel = `<span class="uk-label uk-label-success">Moving</span>`;
            }
            allCount += 1;

            trafficTableHtml += `
                <tr>
                    <td>${aircraft["callsign"]}</td>
                    <td>${statusLabel}</td>
                </tr>
            `;
        }

        var time_to_now = new Date('1970-01-01T' + state["time"] + 'Z');
        var minutes_to_now = Number(time_to_now) / 60000;
        let takeoff_frequency = 0;
        if (minutes_to_now > 0) {
            takeoff_frequency = state["takeoff_count"] / minutes_to_now;
        }

        var total_ticks_on_surface = state["total_ticks_on_surface"]
        let avg_latency = 0;
        if (state["takeoff_count"] > 0) {
            avg_latency = total_ticks_on_surface * 0.5 / state["takeoff_count"];
        }

        $("#traffic-summary").text(`${allCount} aircraft on the surface. ${holdCount} on hold.`);
        $("#performance-frequency").text(`Takeoff frequency: ${takeoff_frequency.toFixed(2)} per minute.`);
        $("#performance-latency").text(`Slide time: ${avg_latency.toFixed(2)} minute(s).`);

        $("#traffic-table > tbody").html(trafficTableHtml);

    }

    toggleAutoRun() {
        if (this.autoRunWorker) {
            clearInterval(this.autoRunWorker);
            // $("#control-run").removeClass("running");
            $("#control-run").attr('uk-icon', "play");
            this.autoRunWorker = null;
        } else {
            this.autoRunWorker = window.setInterval(async () => {
                const nextState = await this.dataConnector.nextState();
                this.handleStateUpdate(nextState);
            }, AUTO_RUN_INTERVAL);
            // $("#control-run").addClass("running");
            $("#control-run").attr('uk-icon', "ban");
        }
    }
}

function parseNodes(rawNodes) {
    var nodes = [];
    for (let node of rawNodes) {
        nodes.push({"lat": node[1], "lng": node[0]});
    }
    return nodes;
}
