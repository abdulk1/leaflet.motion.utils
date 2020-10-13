require('leaflet.motion');

L.Motion.Animate.options.attribution = null; // Removing Attribution

L.Motion.Event.NearPoint = "motion-near-point"; // Custom Event Emitted if latLngToDetect is enabled

L.Motion.Utils.bearing = function (latlng1, latlng2) {
    var rad = Math.PI / 180,
        lat1 = latlng1.lat * rad,
        lat2 = latlng2.lat * rad,
        lon1 = latlng1.lng * rad,
        lon2 = latlng2.lng * rad,
        y = Math.sin(lon2 - lon1) * Math.cos(lat2),
        x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    var bearing = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    return bearing;
};

/**
 * 1/14/20 - VB
 * Overrode Leaflet Polyline Motion's _motion helper function to add two features:
 * 
 *  - Follow Marker: 
 *      - Auto pans map to the location of marker (as motion line is animated)
 *          - To enable: add Motion Option 'followMarker' and set value to true
 * 
 *  - Determine if Motion Line is near pre-defined lat/lng:
 *      - Emit Event when Motion Line is near lat/lng, and end animation
 *          -To enable: add Motion Option 'latLngToDetect' and set value to array of L.LatLng Objs 
 *    
 */
L.Motion.Animate._motion = function (startTime) {
    var ellapsedTime = (new Date()).getTime() - startTime;
    var durationRatio = 1; // 0 - 1
    if (this.motionOptions.duration) {
        durationRatio = ellapsedTime / this.motionOptions.duration;
    }

    if (durationRatio < 1) {
        durationRatio = this.motionOptions.easing(durationRatio, ellapsedTime, 0, 1, this.motionOptions.duration);
        var nextPoint = L.Motion.Utils.interpolateOnLine(this._map, this._linePoints, durationRatio);

        L.Polyline.prototype.addLatLng.call(this, nextPoint.latLng);
        this._drawMarker(nextPoint.latLng);

        // Follow Marker
        if (this.motionOptions.followMarker && this.motionOptions.followMarker === true) {
            this._map.panTo(nextPoint.latLng); // pan map to next lat lng in motion
        }

        // Determine if Motion Line is near pre-defined lat/lng
        if (this.motionOptions.latLngToDetect && this.motionOptions.latLngToDetect.length > 0) {
            // Calculate Current Bearing and Distance to Lat/Lng
            var currBearing = L.Motion.Utils.bearing(nextPoint.latLng, this.motionOptions.latLngToDetect[0].leafletCoordinate);
            var currDistanceToLatLng = this._map.distance(this.motionOptions.latLngToDetect[0].leafletCoordinate, nextPoint.latLng);

            // Determine if Motion Marker has passed Lat/Lng by comparing bearing angles
            if (!this.motionOptions.latLngToDetect[0].markerPassedLatLng && this.motionOptions.latLngToDetect[0].previousBearing !== null) {
                // If angle change falls into this predefined range (ideally 180, if marker is traveling from East to West or West to East on a straight line)
                // We can assume, marker is on the other side of the lat/lng

                var angleDiff = Math.abs(currBearing - this.motionOptions.latLngToDetect[0].previousBearing);
                var onOtherSideOfLatLng = (angleDiff > 130) && (angleDiff <= 340);

                // There is a slight edge case where marker is west, slowly moving east, than turning north. 
                // If this occurs, we detect the angle change 2 times:
                //      - Marker turning north
                //      - Marker then passing lat/lng
                this.motionOptions.latLngToDetect[0].markerPassedLatLng = onOtherSideOfLatLng;
            }

            var bearingCheck = this.motionOptions.latLngToDetect[0].markerPassedLatLng;
            var distanceCheck = currDistanceToLatLng < 100;

            var latLngDetected = bearingCheck && distanceCheck;

            if (latLngDetected) {
                this.fire(L.Motion.Event.NearPoint, {
                    layer: this,
                    data: this.motionOptions.latLngToDetect[0]
                }, false);
                this.motionOptions.latLngToDetect.shift(); // pop lat/lng since we have detected it
                return;
            } else {
                this.motionOptions.latLngToDetect[0].previousBearing = currBearing;
            }
        }

        this.__ellapsedTime = ellapsedTime;
        this.animation = L.Util.requestAnimFrame(function () {
            this._motion(startTime);
        }, this, true);
    } else {
        this.motionStop(true);
    }
};


/**
 * 3/23/20 - VB
 * 
 * Added method to allow motion line segment to begin at a predefined portion/chunk
 * Method mimics Polyline's motionStart()
 */
L.Motion.Animate.motionStartAtChunk = function (chunkLatLng, chunkDuration) {
    if (this._map && !this.animation) {
        if (!this.motionOptions.duration) {
            if (this.motionOptions.speed) {
                this.motionOptions.duration = L.Motion.Utils.getDuration(this._linePoints, this.motionOptions.speed);
            } else {
                this.motionOptions.duration = 0;
            }
        }

        // Ensure Ellapsed Time has a value so ._motion() can calculate durationRatio correctly
        if (this.__ellapsedTime === null || this.__ellapsedTime === undefined){
            this.__ellapsedTime = 0;
        }

        this.setLatLngs(chunkLatLng); // set latLng equal to chunk passed in
        this._motion((new Date).getTime() - this.__ellapsedTime - chunkDuration); // start motion after chunk
        this.fire(L.Motion.Event.Started, {
            layer: this
        }, false);
    }

    return this;
};

L.Motion.Polyline = L.Polyline.extend(L.Motion.Animate);

L.Motion.Seq = L.Motion.Seq.extend({
    options: {
        pane: L.Motion.Animate.options.pane,
        attribution: L.Motion.Animate.options.attribution
    },

    /**
     * 2/4/20 - VB
     * 
     * Added method to allow motion line to begin at an index other than 0
     * Method mimics' motionStart(), but gives the ability to fire off L.Motion.Event.Started or L.Motion.Event.Ended Events
     */
    motionStartAtIndex: function (index, fireStartedEvent, fireEndedEvent) {
        var layers = this.getLayers();

        if (layers && layers.length) {
            this.__prepareStart();

            var indexToStartAt = index;

            if (indexToStartAt > layers.length - 1 || indexToStartAt < 0) {
                indexToStartAt = 0;
            }

            for (var i = 0; i < indexToStartAt; i++) {
                layers[i].setLatLngs(layers[i]._linePoints);

                if (fireStartedEvent) {
                    layers[i].fire(L.Motion.Event.Started, {
                        layer: this
                    }, false);
                }

                if (fireEndedEvent) {
                    layers[i].fire(L.Motion.Event.Ended, {
                        layer: this
                    }, false);
                }
            }

            layers[indexToStartAt].motionStart();

            this.fire(L.Motion.Event.Started, {
                layer: this
            }, false);

        }

        return this;
    },

    /**
     * 1/17/20 - VB
     * 
     * Overrode Leaflet Motion Seq's Motion Resume Method to handle race condition of method being called before
     * the active layer's motion started. If that case arises, we call the .motionStart() on the active layer
     * not .motionResume()
     * 
     */
    motionResume: function () {
        if (this._activeLayer) {
            if (!this._activeLayer.animation && !this._activeLayer.__ellapsedTime) {
                this._activeLayer.motionStart();
            } else {
                this._activeLayer.motionResume();
            }

            this.fire(L.Motion.Event.Resumed, {
                layer: this
            }, false);
        }

        return this;
    },

    /**
     * 3/23/20 - VB
     * 
     * Added method to allow motion line to rewind by miles
     */
    motionRewindByMiles: function (miles) {
        var activeLayer = this._activeLayer;

        if (activeLayer) {
            var layers = this.getLayers();
            var activeLayerIndex = layers.indexOf(activeLayer);
            var totalRewindDistanceInMeters = (miles ? miles : 0.1) * 1609.344;

            // Calculate Active Layer Distance
            var activeLayerLatLngs = activeLayer.getLatLngs();
            var activeLayerDistance = L.Motion.Utils.distance(activeLayerLatLngs);

            // If Active Layer Is First Layer, and layer doesn't have enough distance, restart Active Layer
            if (activeLayerIndex === 0 && (activeLayerDistance < totalRewindDistanceInMeters)) {
                this.motionRewind(0);
            }
            // If Active Layer has enough distance, complete Rewind within Active Layer
            else if (activeLayerDistance >= totalRewindDistanceInMeters) {

                var currLayerLatLng = activeLayer.getLatLngs().map(
                    function (a) {
                        return L.latLng(a.lat, a.lng);
                    }
                );

                if (currLayerLatLng && currLayerLatLng.length >= 2) {
                    var distanceRunningSum = 0;
                    var chunkIndex = -1;

                    for (var i = currLayerLatLng.length - 2; i >= 0; i--) {
                        var currLayerChunk = currLayerLatLng.slice(i);
                        distanceRunningSum = L.Motion.Utils.distance(currLayerChunk);

                        if (distanceRunningSum > totalRewindDistanceInMeters) {
                            chunkIndex = i;
                            break;
                        }
                    }

                    if (chunkIndex !== -1) {
                        var chunkLatLng = currLayerLatLng.slice(0, chunkIndex);
                        var chunkDuration = L.Motion.Utils.getDuration(chunkLatLng, activeLayer.motionOptions.speed);

                        this.__stopLayerAtIndex__(activeLayerIndex);

                        this.__prepareStart();
                        activeLayer.motionStartAtChunk(chunkLatLng, chunkDuration);

                        this.fire(L.Motion.Event.Started, {
                            layer: this
                        }, false);

                    } else {
                        this.motionRewind(0);
                    }
                } else {
                    this.motionRewind(0);
                }

            } else { // If Active Layer doesn't have enough distance, iterate backwards to find enough distance to complete Rewind
                var distanceToRecover = totalRewindDistanceInMeters - activeLayerDistance;
                var distanceToRecoverRunningSum = 0;
                var layerIndexRefArr = [];

                for (var l = activeLayerIndex - 1; l >= 0; l--) {

                    var currLayerIterLatLng = layers[l].getLatLngs().map(
                        function (a) {
                            return L.latLng(a.lat, a.lng);
                        }
                    );

                    if (currLayerIterLatLng && currLayerIterLatLng.length >= 2) {
                        var distanceRunningSum = 0;
                        var chunkIndex = -1;

                        for (var j = currLayerIterLatLng.length - 2; j >= 0; j--) {
                            var currLayerIterChunk = currLayerIterLatLng.slice(j);
                            distanceRunningSum = L.Motion.Utils.distance(currLayerIterChunk);

                            if ((distanceRunningSum + distanceToRecoverRunningSum) > distanceToRecover) {
                                chunkIndex = j;
                                break;
                            }
                        }

                        if (chunkIndex !== -1) { // Recovered enough distance from this layer
                            var chunkLatLng = currLayerIterLatLng.slice(0, chunkIndex);
                            var chunkDuration = L.Motion.Utils.getDuration(chunkLatLng, layers[l].motionOptions.speed);

                            // Reset Active Layer
                            this.__stopLayerAtIndex__(activeLayerIndex);
                            layers[activeLayerIndex].setLatLngs([]);

                            // Reset layers that contributed to 'Distance to Recover' Running Sum
                            for (var k = 0; k < layerIndexRefArr.length; k++) {
                                layers[layerIndexRefArr[k]].setLatLngs([]);
                            }

                            this.__prepareStart();
                            layers[l].motionStartAtChunk(chunkLatLng, chunkDuration);

                            this.fire(L.Motion.Event.Started, {
                                layer: this
                            }, false);

                            break;
                        } else {
                            // Did not recover enough distance from this layer
                            // Add this layer's running sum to our 'Distance To Recover' Running Sum
                            layerIndexRefArr.push(l);
                            distanceToRecoverRunningSum += distanceRunningSum;
                        }
                    } else {
                        this.motionRewind(0);
                        break;
                    }
                }
            }
        }

        return this;
    },

    motionRewind: function (decrementNum) {
        var activeLayer = this._activeLayer;

        if (activeLayer) {
            var layers = this.getLayers();
            var currentIndex = layers.indexOf(activeLayer);
            var indexToRewindTo = currentIndex - decrementNum;

            if (indexToRewindTo < 0) {
                indexToRewindTo = 0;
            }

            if (indexToRewindTo >= 0 && layers[indexToRewindTo]) {
                var prevLayer = layers[indexToRewindTo];

                this.__stopLayerAtIndex__(currentIndex);

                for (var i = currentIndex; i >= indexToRewindTo; i--) {
                    layers[i].setLatLngs([]);
                }

                if (prevLayer) {
                    this.__prepareStart();
                    prevLayer.motionStart();
                    this.fire(L.Motion.Event.Started, {
                        layer: this
                    }, false);
                }
            }
        }
        return this;
    },

    motionFastForward: function (incrementNum) {
        var activeLayer = this._activeLayer;

        if (activeLayer) {
            var layers = this.getLayers();
            var currentIndex = layers.indexOf(activeLayer);
            var indexToFastForwardTo = currentIndex + incrementNum;

            if (indexToFastForwardTo > layers.length - 1) {
                indexToFastForwardTo = layers.length - 1;
            }

            if (indexToFastForwardTo >= 0 && layers[indexToFastForwardTo]) {
                var nexLayer = layers[indexToFastForwardTo];

                this.__stopLayerAtIndex__(currentIndex);

                for (var i = currentIndex; i <= indexToFastForwardTo; i++) {
                    layers[i].setLatLngs(layers[i]._linePoints);
                }

                if (nexLayer) {
                    this.__prepareStart();
                    nexLayer.motionStart();
                    this.fire(L.Motion.Event.Started, {
                        layer: this
                    }, false);
                }
            }
        }
        return this;
    },

    motionSpeedChange: function (newSpeed) {
        var activeLayer = this._activeLayer;

        if (activeLayer) {
            var layers = this.getLayers();
            var currentIndex = layers.indexOf(activeLayer);

            var animationPresentOnActiveLayer = this._activeLayer.animation;
            var activeLayerOldDuration = this._activeLayer.motionOptions.duration;
            var activeLayerNewDuration = 0;
            var activeLayerOldElapsedTime = this._activeLayer.__ellapsedTime;
            var activeLayerNewElapsedTime = 0;

            if (animationPresentOnActiveLayer) {
                L.Util.cancelAnimFrame(this._activeLayer.animation);
                this._activeLayer.animation = null;
            }

            for (var i = 0; i < layers.length; i++) {
                var newMotionDuration = L.Motion.Utils.getDuration(layers[i]._linePoints, newSpeed);
                layers[i].motionSpeed(newSpeed); // update speed
                layers[i].motionDuration(newMotionDuration); // update duration

                if (i === currentIndex) {
                    activeLayerNewDuration = newMotionDuration;
                }
            }

            activeLayerNewElapsedTime = (activeLayerOldElapsedTime * activeLayerNewDuration) / activeLayerOldDuration;

            if (animationPresentOnActiveLayer) {
                this._activeLayer._motion((new Date()).getTime() - activeLayerNewElapsedTime);
            } else {
                this._activeLayer.__ellapsedTime = activeLayerNewElapsedTime;
            }
        }
        return this;
    },

    __stopLayerAtIndex__: function (index) {
        var layers = this.getLayers();
        if (layers && layers[index]) {
            layers[index].off(L.Motion.Event.Ended);
            layers[index].motionStop();
        }
    }
});

// export needed modules
exports.motion = L.motion;
exports.Motion = L.Motion;